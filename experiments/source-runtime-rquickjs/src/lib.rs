mod network;

use std::{
    fmt,
    time::{Duration, Instant},
};

use network::{NetworkPolicy, NetworkRequest, build_client, execute_network};
use rquickjs::{Context, Function, Runtime};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::{Origin, Url};

const RUNTIME_DEADLINE: Duration = Duration::from_secs(15);
const MAX_BRIDGE_ITERATIONS: usize = 128;

pub struct ResolveInput<'a> {
    pub script: &'a str,
    pub source: &'a str,
    pub track_id: &'a str,
    pub quality: &'a str,
    pub allowed_origin: &'a str,
    pub allow_http_loopback: bool,
}

pub struct ResolvedUrl {
    url: Url,
}

impl ResolvedUrl {
    pub fn url(&self) -> &Url {
        &self.url
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn for_test(value: &str) -> Self {
        Self {
            url: Url::parse(value).expect("test URL must be valid"),
        }
    }
}

pub struct SuccessSummary {
    scheme: String,
    host: String,
    character_length: usize,
    sha256: String,
}

impl fmt::Display for SuccessSummary {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "resolved=true scheme={} host={} length={} sha256={}",
            self.scheme, self.host, self.character_length, self.sha256
        )
    }
}

pub fn summarize(resolved: &ResolvedUrl) -> SuccessSummary {
    let value = resolved.url.as_str();
    let digest = Sha256::digest(value.as_bytes());
    let sha256 = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    SuccessSummary {
        scheme: resolved.url.scheme().to_owned(),
        host: resolved.url.host_str().unwrap_or_default().to_owned(),
        character_length: value.chars().count(),
        sha256,
    }
}

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("invalid runtime input")]
    InvalidInput,
    #[error("source initialization failed")]
    Initialization,
    #[error("source protocol failed")]
    Protocol,
    #[error("source network request failed")]
    Network,
    #[error("source execution timed out")]
    Timeout,
    #[error("source returned an invalid playback URL")]
    InvalidResolvedUrl,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    initialized: Option<Value>,
    has_request_handler: bool,
    result: Option<RuntimeResult>,
}

#[derive(Deserialize)]
struct RuntimeResult {
    ok: bool,
    value: Option<Value>,
}

fn read_state(context: &Context) -> Result<RuntimeState, RuntimeError> {
    let raw = context
        .with(|ctx| {
            let function: Function = ctx.globals().get("__tuneflowState")?;
            function.call::<_, String>(())
        })
        .map_err(|_| RuntimeError::Protocol)?;
    serde_json::from_str(&raw).map_err(|_| RuntimeError::Protocol)
}

fn drain(context: &Context) -> Result<Vec<NetworkRequest>, RuntimeError> {
    let raw = context
        .with(|ctx| {
            let function: Function = ctx.globals().get("__tuneflowDrain")?;
            function.call::<_, String>(())
        })
        .map_err(|_| RuntimeError::Protocol)?;
    let encoded: Vec<String> = serde_json::from_str(&raw).map_err(|_| RuntimeError::Protocol)?;
    encoded
        .into_iter()
        .map(|packet| serde_json::from_str(&packet).map_err(|_| RuntimeError::Protocol))
        .collect()
}

pub fn resolve_music_url(input: ResolveInput<'_>) -> Result<ResolvedUrl, RuntimeError> {
    if [input.script, input.source, input.track_id, input.quality]
        .iter()
        .any(|value| value.is_empty())
    {
        return Err(RuntimeError::InvalidInput);
    }
    let allowed = Url::parse(input.allowed_origin).map_err(|_| RuntimeError::InvalidInput)?;
    let allowed_origin = allowed.origin();
    if matches!(allowed_origin, Origin::Opaque(_)) {
        return Err(RuntimeError::InvalidInput);
    }

    let deadline = Instant::now() + RUNTIME_DEADLINE;
    let runtime = Runtime::new().map_err(|_| RuntimeError::Initialization)?;
    runtime.set_memory_limit(64 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::full(&runtime).map_err(|_| RuntimeError::Initialization)?;
    context
        .with(|ctx| {
            ctx.eval::<(), _>(include_str!("bootstrap.js"))?;
            ctx.eval::<(), _>(input.script)
        })
        .map_err(|_| RuntimeError::Initialization)?;

    let client = build_client()?;
    let policy = NetworkPolicy {
        allowed_origin,
        allow_http_loopback: input.allow_http_loopback,
    };
    let mut request_count = 0;
    let mut initialized = false;
    for _ in 0..MAX_BRIDGE_ITERATIONS {
        if Instant::now() >= deadline {
            return Err(RuntimeError::Timeout);
        }
        while runtime
            .execute_pending_job()
            .map_err(|_| RuntimeError::Initialization)?
        {}
        let state = read_state(&context).map_err(|_| RuntimeError::Initialization)?;
        if state.initialized.is_some() && state.has_request_handler {
            initialized = true;
            break;
        }
        for packet in drain(&context).map_err(|_| RuntimeError::Initialization)? {
            request_count += 1;
            if request_count > 1 {
                return Err(RuntimeError::Protocol);
            }
            let delivery = execute_network(&client, packet, &policy)?;
            let raw = serde_json::to_string(&delivery).map_err(|_| RuntimeError::Protocol)?;
            context
                .with(|ctx| {
                    let function: Function = ctx.globals().get("__tuneflowDeliver")?;
                    function.call::<_, ()>((raw,))
                })
                .map_err(|_| RuntimeError::Initialization)?;
        }
    }
    if !initialized {
        return Err(RuntimeError::Initialization);
    }

    let invocation = serde_json::to_string(&json!({
        "source": input.source,
        "action": "musicUrl",
        "info": {
            "musicInfo": { "songmid": input.track_id },
            "type": input.quality,
        },
    }))
    .map_err(|_| RuntimeError::Protocol)?;
    context
        .with(|ctx| {
            let function: Function = ctx.globals().get("__tuneflowInvoke")?;
            function.call::<_, ()>((invocation,))
        })
        .map_err(|_| RuntimeError::Protocol)?;

    for _ in 0..MAX_BRIDGE_ITERATIONS {
        if Instant::now() >= deadline {
            return Err(RuntimeError::Timeout);
        }
        let packets = drain(&context)?;
        for packet in packets {
            request_count += 1;
            if request_count > 1 {
                return Err(RuntimeError::Protocol);
            }
            let delivery = execute_network(&client, packet, &policy)?;
            let raw = serde_json::to_string(&delivery).map_err(|_| RuntimeError::Protocol)?;
            context
                .with(|ctx| {
                    let function: Function = ctx.globals().get("__tuneflowDeliver")?;
                    function.call::<_, ()>((raw,))
                })
                .map_err(|_| RuntimeError::Protocol)?;
        }
        while runtime
            .execute_pending_job()
            .map_err(|_| RuntimeError::Protocol)?
        {}
        if let Some(result) = read_state(&context)?.result {
            if !result.ok {
                return Err(RuntimeError::Protocol);
            }
            let value = result
                .value
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                .ok_or(RuntimeError::InvalidResolvedUrl)?;
            let url = Url::parse(&value).map_err(|_| RuntimeError::InvalidResolvedUrl)?;
            if url.scheme() != "http" && url.scheme() != "https" {
                return Err(RuntimeError::InvalidResolvedUrl);
            }
            return Ok(ResolvedUrl { url });
        }
    }
    Err(RuntimeError::Timeout)
}
