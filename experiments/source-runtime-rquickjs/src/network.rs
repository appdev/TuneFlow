use std::{collections::BTreeMap, io::Read, time::Duration};

use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::{Host, Origin, Url};

use crate::RuntimeError;

pub(crate) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub(crate) struct NetworkPolicy {
    pub allowed_origin: Origin,
    pub allow_http_loopback: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NetworkRequest {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: u64,
    pub url: String,
    #[serde(default)]
    pub options: NetworkOptions,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct NetworkOptions {
    pub method: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, Value>,
    pub body: Option<Value>,
    pub form: Option<Value>,
    #[serde(rename = "formData")]
    pub form_data: Option<Value>,
}

#[derive(Serialize)]
pub(crate) struct NetworkDelivery {
    pub id: u64,
    pub response: NetworkResponse,
}

#[derive(Serialize)]
pub(crate) struct NetworkResponse {
    #[serde(rename = "statusCode")]
    status_code: u16,
    #[serde(rename = "statusMessage")]
    status_message: String,
    headers: BTreeMap<String, String>,
    body: Value,
}

pub(crate) fn build_client() -> Result<Client, RuntimeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(10))
        .referer(false)
        .no_proxy()
        .build()
        .map_err(|_| RuntimeError::Network)
}

pub(crate) fn execute_network(
    client: &Client,
    packet: NetworkRequest,
    policy: &NetworkPolicy,
) -> Result<NetworkDelivery, RuntimeError> {
    if packet.kind != "network" {
        return Err(RuntimeError::Protocol);
    }
    let target = Url::parse(&packet.url).map_err(|_| RuntimeError::Network)?;
    if target.origin() != policy.allowed_origin {
        return Err(RuntimeError::Network);
    }
    let is_loopback = match target.host() {
        Some(Host::Ipv4(value)) => value.is_loopback(),
        Some(Host::Ipv6(value)) => value.is_loopback(),
        _ => false,
    };
    let loopback_http = policy.allow_http_loopback && target.scheme() == "http" && is_loopback;
    if target.scheme() != "https" && !loopback_http {
        return Err(RuntimeError::Network);
    }
    if packet.options.method.as_deref().unwrap_or("GET") != "GET"
        || packet.options.body.is_some()
        || packet.options.form.is_some()
        || packet.options.form_data.is_some()
    {
        return Err(RuntimeError::Protocol);
    }

    let mut headers = HeaderMap::new();
    for (name, value) in packet.options.headers {
        let value = value.as_str().ok_or(RuntimeError::Protocol)?;
        if name.contains(['\r', '\n']) || value.contains(['\r', '\n']) {
            return Err(RuntimeError::Protocol);
        }
        headers.insert(
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| RuntimeError::Protocol)?,
            HeaderValue::from_str(value).map_err(|_| RuntimeError::Protocol)?,
        );
    }

    let response = client
        .get(target)
        .headers(headers)
        .send()
        .map_err(|_| RuntimeError::Network)?;
    if response.status().is_redirection() {
        return Err(RuntimeError::Network);
    }
    let status_code = response.status().as_u16();
    let status_message = response
        .status()
        .canonical_reason()
        .unwrap_or_default()
        .to_owned();
    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_owned(), value.to_owned()))
        })
        .collect();
    let mut bytes = Vec::new();
    response
        .take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| RuntimeError::Network)?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(RuntimeError::Network);
    }
    let text = String::from_utf8(bytes).map_err(|_| RuntimeError::Network)?;
    let body = serde_json::from_str(&text).unwrap_or(Value::String(text));

    Ok(NetworkDelivery {
        id: packet.id,
        response: NetworkResponse {
            status_code,
            status_message,
            headers: response_headers,
            body,
        },
    })
}
