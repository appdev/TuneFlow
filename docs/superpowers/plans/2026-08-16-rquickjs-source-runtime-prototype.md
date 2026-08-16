# RQuickJS Source Runtime Prototype Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Rust CLI that executes one existing TuneFlow/LX source with `rquickjs`, bridges one real HTTPS request, and verifies that the source returns a valid playback URL without logging that URL.

**Architecture:** A per-invocation QuickJS runtime evaluates a JavaScript compatibility bootstrap and the selected source. JavaScript and Rust exchange JSON packets through bootstrap-owned queues; Rust executes one allowlisted blocking HTTPS request, delivers the response, drives pending QuickJS jobs, validates the result, and prints only a redacted summary.

**Tech Stack:** Rust 1.97.1, `rquickjs` 0.12.2, `reqwest` 0.13.4 blocking client with rustls, `serde`/`serde_json`, `url`, `sha2`, and Cargo integration tests.

## Global Constraints

- Work only under `experiments/source-runtime-rquickjs/` plus approved documentation.
- Do not modify the production Node Service, npm scripts, Docker image, database, downloads, or any file under `data/`.
- Live smoke source: existing readable `Huibq_lxmusic源`; input: provider `tx`, track `002bChfZ1sw9ed`, quality `128k`.
- Never hard-code or print the source API origin, request key, headers, body, source contents, or complete resolved URL.
- Production-mode requests are HTTPS-only, GET-only, exact-origin allowlisted, redirect-disabled, limited to one request and 1 MiB.
- Tests may explicitly allow an HTTP loopback origin.
- QuickJS limits: 64 MiB heap, 1 MiB stack, 15 second deadline, at most 128 bridge iterations.
- Preserve unrelated dirty-worktree changes. Do not commit without separate authorization.

---

## File Structure

- `experiments/source-runtime-rquickjs/Cargo.toml` — independent crate and dependencies.
- `experiments/source-runtime-rquickjs/src/bootstrap.js` — sandbox-owned LX API and JSON queues.
- `experiments/source-runtime-rquickjs/src/lib.rs` — runtime lifecycle, bridge loop, public API, URL validation, and redaction.
- `experiments/source-runtime-rquickjs/src/network.rs` — origin policy and bounded blocking HTTP.
- `experiments/source-runtime-rquickjs/src/main.rs` — strict CLI parsing and redacted output.
- `experiments/source-runtime-rquickjs/tests/runtime_smoke.rs` — deterministic end-to-end and guardrail tests.

### Task 1: Establish the failing end-to-end contract

**Files:**
- Create: `experiments/source-runtime-rquickjs/Cargo.toml`
- Create: `experiments/source-runtime-rquickjs/tests/runtime_smoke.rs`

**Interfaces:**
- Consumes: script text, source ID, track ID, quality, and allowed origin.
- Produces later: `resolve_music_url(ResolveInput) -> Result<ResolvedUrl, RuntimeError>`.

- [ ] **Step 1: Create the Cargo manifest**

```toml
[package]
name = "tuneflow-source-runtime-prototype"
version = "0.1.0"
edition = "2024"
publish = false

[features]
test-support = []

[dependencies]
reqwest = { version = "=0.13.4", default-features = false, features = ["blocking", "json", "rustls"] }
rquickjs = "=0.12.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sha2 = "0.10"
thiserror = "2.0"
url = "2.5"
```

- [ ] **Step 2: Write a deterministic full-chain test**

In `tests/runtime_smoke.rs`, start a one-shot `TcpListener` on `127.0.0.1:0`. It must assert that it receives `GET /resolve`, then return:

```json
{"url":"https://media.example.test/audio.flac"}
```

Use this fixture source, substituting the local origin with `format!`:

```js
const { EVENT_NAMES, on, send, request } = globalThis.lx;
on(EVENT_NAMES.request, ({ action }) => new Promise((resolve, reject) => {
  if (action !== 'musicUrl') return reject(new Error('unexpected action'));
  request('LOCAL_ORIGIN/resolve', { method: 'GET' }, (error, response) => {
    if (error) reject(error); else resolve(response.body.url);
  });
}));
send(EVENT_NAMES.inited, {
  sources: { fixture: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
});
```

Call:

```rust
let resolved = resolve_music_url(ResolveInput {
    script: &script,
    source: "fixture",
    track_id: "fixture-track",
    quality: "128k",
    allowed_origin: &origin,
    allow_http_loopback: true,
}).unwrap();
assert_eq!(resolved.url().as_str(), "https://media.example.test/audio.flac");
```

- [ ] **Step 3: Verify RED**

Run:

```sh
cd experiments/source-runtime-rquickjs
cargo test --test runtime_smoke resolves_a_music_url_through_the_json_network_bridge -- --exact
```

Expected: compilation fails because the library and `resolve_music_url` API do not exist. Dependency or toolchain failures are not the intended RED state.

### Task 2: Implement the minimal QuickJS and network bridge

**Files:**
- Create: `experiments/source-runtime-rquickjs/src/bootstrap.js`
- Create: `experiments/source-runtime-rquickjs/src/lib.rs`
- Create: `experiments/source-runtime-rquickjs/src/network.rs`
- Test: `experiments/source-runtime-rquickjs/tests/runtime_smoke.rs`

**Interfaces:**
- Produces: `ResolveInput`, `ResolvedUrl::url`, `RuntimeError`, and `resolve_music_url`.
- Internal bridge functions: `__tuneflowState`, `__tuneflowDrain`, `__tuneflowDeliver`, and `__tuneflowInvoke`.

- [ ] **Step 1: Add a second failing test for origin rejection**

Before production code exists, add `rejects_a_source_request_outside_the_allowed_origin`. Have its fixture source request a local server while `allowed_origin` is `https://allowed.example`. Assert that the final error text equals `source network request failed`, contains no loopback host, and a nonblocking listener is never contacted. This test shares the existing compile-failing RED state with the full-chain test.

- [ ] **Step 2: Add the sandbox-owned JavaScript bootstrap**

`src/bootstrap.js` must own `outbound`, callback records, initialization state, request handler, and final result. Install exactly this compatibility surface:

```js
(() => {
  const outbound = [];
  const callbacks = Object.create(null);
  let requestHandler;
  let initialized;
  let result;
  let sequence = 0;
  const EVENT_NAMES = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' });
  const runtime = {
    EVENT_NAMES,
    env: 'desktop',
    version: '2.0.0',
    currentScriptInfo: Object.freeze({}),
    on(name, handler) {
      if (name !== EVENT_NAMES.request || typeof handler !== 'function') return Promise.reject(new Error('unsupported event'));
      requestHandler = handler;
      return Promise.resolve();
    },
    send(name, value) {
      if (name === EVENT_NAMES.inited && initialized === undefined) initialized = JSON.parse(JSON.stringify(value));
      return Promise.resolve();
    },
    request(url, options, callback) {
      if (typeof callback !== 'function') throw new TypeError('request callback required');
      const id = ++sequence;
      callbacks[id] = callback;
      outbound.push(JSON.stringify({ type: 'network', id, url: String(url), options: JSON.parse(JSON.stringify(options || {})) }));
      return () => { delete callbacks[id]; };
    },
  };
  globalThis.window = globalThis;
  globalThis.lx = runtime;
  globalThis.tuneflow = runtime;
  globalThis.console = Object.freeze({ log() {}, error() {}, warn() {}, group() {}, groupEnd() {} });
  globalThis.__tuneflowState = () => JSON.stringify({ initialized, hasRequestHandler: typeof requestHandler === 'function', result });
  globalThis.__tuneflowDrain = () => JSON.stringify(outbound.splice(0));
  globalThis.__tuneflowDeliver = raw => {
    const packet = JSON.parse(raw);
    const callback = callbacks[packet.id];
    if (!callback) return;
    delete callbacks[packet.id];
    callback(packet.error ? Object.assign(new Error(packet.error.message), { code: packet.error.code }) : null, packet.response);
  };
  globalThis.__tuneflowInvoke = raw => {
    if (typeof requestHandler !== 'function') throw new Error('source request handler missing');
    Promise.resolve(requestHandler(JSON.parse(raw))).then(
      value => { result = { ok: true, value }; },
      () => { result = { ok: false, error: { code: 'SOURCE_ERROR', message: 'source request failed' } }; },
    );
  };
})();
```

The bridge remains JSON-only. Do not expose Rust functions, modules, files, `fetch`, a real console, or dynamic module loading.

- [ ] **Step 3: Add the bounded network adapter**

In `src/network.rs`, define:

```rust
pub(crate) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub(crate) struct NetworkPolicy {
    pub allowed_origin: url::Origin,
    pub allow_http_loopback: bool,
}

pub(crate) fn execute_network(
    client: &reqwest::blocking::Client,
    packet: NetworkRequest,
    policy: &NetworkPolicy,
) -> Result<NetworkDelivery, RuntimeError>;
```

Before sending, require exact `Url::origin()` equality, HTTPS, and `GET`. The only exception is explicit test mode targeting a parsed loopback IP over HTTP. Reject request bodies, invalid/non-string headers, CR/LF, 3xx, and unsupported options. Configure the client with `Policy::none()`, 10 second timeout, `referer(false)`, and `no_proxy()`. Read with `Read::take(1_048_577)`, rejecting more than 1 MiB. Parse UTF-8 JSON when valid, otherwise return a JSON string. Errors must never include URLs, headers, or bodies.

- [ ] **Step 4: Add the public runtime API**

In `src/lib.rs`, define:

```rust
pub struct ResolveInput<'a> {
    pub script: &'a str,
    pub source: &'a str,
    pub track_id: &'a str,
    pub quality: &'a str,
    pub allowed_origin: &'a str,
    pub allow_http_loopback: bool,
}

pub struct ResolvedUrl { url: url::Url }
impl ResolvedUrl { pub fn url(&self) -> &url::Url { &self.url } }

#[derive(thiserror::Error, Debug)]
pub enum RuntimeError {
    #[error("invalid runtime input")] InvalidInput,
    #[error("source initialization failed")] Initialization,
    #[error("source protocol failed")] Protocol,
    #[error("source network request failed")] Network,
    #[error("source execution timed out")] Timeout,
    #[error("source returned an invalid playback URL")] InvalidResolvedUrl,
}

pub fn resolve_music_url(input: ResolveInput<'_>) -> Result<ResolvedUrl, RuntimeError>;
```

Do not derive `Debug` for `ResolvedUrl`.

- [ ] **Step 5: Implement the bounded orchestration loop**

`resolve_music_url` must:

1. Validate the allowed origin and all nonempty input fields before evaluating JS.
2. Create `Runtime::new()`, set memory to `64 * 1024 * 1024`, stack to `1024 * 1024`, and install a deadline interrupt handler.
3. Evaluate `include_str!("bootstrap.js")`, then the source script in `Context::full`.
4. Read `__tuneflowState()` and require both initialization and a request handler.
5. Invoke the handler with JSON containing `source`, action `musicUrl`, and `info.musicInfo.songmid` plus `info.type`.
6. For at most 128 iterations: drain packets, execute at most one network request, deliver its JSON response, call `runtime.execute_pending_job()` until empty, then check result state.
7. Reject unknown packets, multiple requests, duplicate/missing results, non-string values, or deadline expiry.
8. Parse the returned string with `Url`, require `http` or `https`, and return `ResolvedUrl`.

- [ ] **Step 6: Verify both contracts GREEN**

Run:

```sh
cargo test --test runtime_smoke resolves_a_music_url_through_the_json_network_bridge -- --exact
cargo test --test runtime_smoke rejects_a_source_request_outside_the_allowed_origin -- --exact
```

Expected: both PASS; the full-chain test makes one local request, while the disallowed-origin test makes none.

### Task 3: Prove URL redaction

**Files:**
- Modify: `experiments/source-runtime-rquickjs/src/lib.rs`
- Modify: `experiments/source-runtime-rquickjs/tests/runtime_smoke.rs`

**Interfaces:**
- Produces: `summarize(&ResolvedUrl) -> SuccessSummary` with safe `Display` output.

- [ ] **Step 1: Write and run the failing redaction test**

Add a `ResolvedUrl::for_test` constructor behind `#[cfg(any(test, feature = "test-support"))]`. Use a URL with a secret path and query. Assert the rendered summary contains `resolved=true`, scheme, host, length, and `sha256=`, but none of the path/query values.

Run:

```sh
cargo test --features test-support --test runtime_smoke redacts_the_complete_playback_url -- --exact
```

Expected RED: summary APIs do not exist.

- [ ] **Step 2: Implement redacted summary formatting and verify GREEN**

Add:

```rust
pub struct SuccessSummary {
    scheme: String,
    host: String,
    character_length: usize,
    sha256: String,
}
pub fn summarize(resolved: &ResolvedUrl) -> SuccessSummary;
```

Hash the complete URL bytes with SHA-256. `Display` emits exactly one line shaped like:

```text
resolved=true scheme=https host=media.example.test length=67 sha256=<64 lowercase hex characters>
```

The numeric length is computed, not fixed. Run `cargo test --features test-support`; expect all deterministic tests PASS without sensitive output.

### Task 4: Add the CLI and execute the real source smoke

**Files:**
- Create: `experiments/source-runtime-rquickjs/src/main.rs`
- Modify: `experiments/source-runtime-rquickjs/tests/runtime_smoke.rs`
- Read only: `data/sources/a9adeb456690b523008038224091cee31977606302d79082eb06adb3c75c9146.js`

**Interfaces:**
- CLI flags: `--script`, `--source`, `--track-id`, `--quality`, `--allow-origin`.
- Success stdout: `SuccessSummary`; failure stderr: one sanitized `source runtime failed: ...` line.

- [ ] **Step 1: Write and run the failing CLI usage test**

Launch `env!("CARGO_BIN_EXE_tuneflow-source-runtime-prototype")` without arguments. Require nonzero exit and this stderr line:

```text
usage: tuneflow-source-runtime-prototype --script <path> --source <id> --track-id <id> --quality <quality> --allow-origin <origin>
```

Run:

```sh
cargo test --features test-support --test runtime_smoke rejects_missing_cli_arguments -- --exact
```

Expected RED: the binary target does not exist.

- [ ] **Step 2: Implement strict CLI parsing**

Use `std::env::args_os`, accepting each required flag exactly once. Reject missing, empty, or unknown arguments. Read the script, call `resolve_music_url` with `allow_http_loopback: false`, and print only `summarize(&resolved)`. Never print arguments, source content, network packets, or the resolved URL.

- [ ] **Step 3: Verify deterministic quality gates**

Run:

```sh
cargo fmt --check
cargo test --features test-support
cargo clippy --all-targets --features test-support -- -D warnings
```

Expected: all exit 0 with no warnings or sensitive output.

- [ ] **Step 4: Derive the live allowed origin without displaying it**

From repository root:

```sh
SOURCE_SCRIPT="data/sources/a9adeb456690b523008038224091cee31977606302d79082eb06adb3c75c9146.js"
SOURCE_ALLOWED_ORIGIN="$(node -e "const fs=require('node:fs');const text=fs.readFileSync(process.argv[1],'utf8');const value=/const API_URL = ['\"]([^'\"]+)['\"]/.exec(text)?.[1];if(!value)process.exit(1);process.stdout.write(new URL(value).origin)" "$SOURCE_SCRIPT")"
```

Do not use `set -x`, `echo`, `env`, or anything that prints this variable.

- [ ] **Step 5: Run the real URL smoke**

```sh
cargo run --quiet --manifest-path experiments/source-runtime-rquickjs/Cargo.toml -- \
  --script "$SOURCE_SCRIPT" \
  --source tx \
  --track-id 002bChfZ1sw9ed \
  --quality 128k \
  --allow-origin "$SOURCE_ALLOWED_ORIGIN"
unset SOURCE_ALLOWED_ORIGIN
```

Expected success: one redacted `resolved=true` line with scheme, host, length, and SHA-256 only. If the third-party API is unavailable, preserve deterministic passing evidence and report the live smoke as externally blocked rather than weakening validation.

### Task 5: Final review and frozen verification

**Files:**
- Review only: `experiments/source-runtime-rquickjs/**`
- Review only: approved design and plan documents.

- [ ] **Step 1: Inspect the final diff and worktree**

```sh
git diff -- experiments/source-runtime-rquickjs docs/superpowers/specs/2026-08-16-rquickjs-source-runtime-prototype-design.md docs/superpowers/plans/2026-08-16-rquickjs-source-runtime-prototype.md
git status --short
```

Confirm that unrelated download changes remain untouched, `target/` is untracked or ignored, no source/URL/header/body/credential entered the diff, and no debug output remains.

- [ ] **Step 2: Run final verification on the frozen tree**

```sh
cd experiments/source-runtime-rquickjs
cargo fmt --check
cargo test --features test-support
cargo clippy --all-targets --features test-support -- -D warnings
```

Then repeat the Task 4 live smoke. Report deterministic tests and the external smoke separately. Do not infer compatibility with other installed sources or production security suitability.
