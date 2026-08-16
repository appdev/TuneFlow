# RQuickJS Source Runtime Prototype Design

**Date:** 2026-08-16

## Goal

Prove that a standalone Rust executable using `rquickjs` can load one existing
TuneFlow/LX music-source script, initialize it, invoke its `musicUrl` handler
with real track metadata, perform the source-requested HTTPS call, and receive
a valid resolved playback URL.

The prototype evaluates runtime compatibility only. It does not replace or
integrate with the production Node.js source worker.

## Selected Source and Smoke Input

The live smoke run uses the existing, readable `Huibq_lxmusic源` script from
`data/sources/`. It invokes the source's Tencent provider with the existing
track identifier `002bChfZ1sw9ed` at `128k` quality.

The source script remains the authority for its upstream request path and
headers. The prototype does not copy its API address, request key, or resolved
playback URL into Rust source code, tests, documentation, or logs.

## Repository Boundary

Create an independent Cargo project under
`experiments/source-runtime-rquickjs/`. It must not modify the Service runtime,
source repository, database, download manager, build output, or Docker image.
It reads the selected source script and smoke input but does not write under
`data/`.

No existing npm script is changed for this experiment. The prototype is built,
tested, and run with Cargo commands from its own directory.

## Components

### CLI

The executable accepts a source-script path, provider, track identifier, and
quality. Its live smoke invocation additionally receives an allowed upstream
origin. The CLI reads the script, constructs the runtime, performs one
`musicUrl` invocation, validates the result, prints a redacted success summary,
and exits.

The success summary contains only whether resolution succeeded, the URL scheme,
host, character length, and SHA-256 digest. The complete playback URL and
source-request headers are never printed.

### JavaScript runtime

One `rquickjs` runtime and context are created per CLI invocation. The runtime
sets explicit memory and stack limits and installs an interrupt handler tied to
a wall-clock deadline.

The context provides standard ECMAScript facilities from QuickJS plus this
minimal compatibility surface:

- `window` aliases `globalThis`.
- `globalThis.lx` and `globalThis.tuneflow` reference the same runtime object.
- `EVENT_NAMES` contains `request`, `inited`, and `updateAlert`.
- `on`, `send`, and `request` implement the source protocol used by the chosen
  script.
- `env` is `desktop` and `version` is `2.0.0`.
- `console` methods used by the source are inert.

The prototype does not expose module loading, filesystem access, environment
variables, subprocesses, native objects, or Rust host functions directly to
the source script.

### JSON bridge

The JavaScript bootstrap owns source callbacks and communicates with Rust
through serialized JSON queues. `send(inited, value)` records initialization,
`on(request, handler)` records the music action handler, and
`request(url, options, callback)` emits a network message while retaining the
callback in the JavaScript realm.

Rust drains messages after script evaluation and while settling the invoked
handler. For each network message, Rust performs the allowed HTTPS request and
delivers a JSON response packet back to the bootstrap. The bootstrap invokes
the retained callback, allowing the source Promise to settle. Rust continues
executing pending QuickJS jobs until it receives a response or an error.

## Network Boundary

The prototype supports HTTPS requests only. A live invocation must specify one
allowed origin, and every source-requested URL must match its scheme, host, and
effective port. Redirects are disabled so the upstream cannot redirect the
prototype outside that origin.

Request and response bodies, headers, message counts, and elapsed time are
bounded. The initial implementation only needs the GET request and string/JSON
response behavior exercised by the selected source. Unsupported request
features fail closed with a protocol error.

This origin allowlist is intentionally narrower than the production Service's
general SSRF layer. Reusing or porting the production network policy belongs to
a later integration design.

## Error Handling

The CLI exits nonzero with a sanitized error when script evaluation,
initialization, protocol validation, network access, Promise settlement, URL
validation, or a resource limit fails. Errors may identify the failed phase and
stable error category but must not include the full resolved URL, request
headers, response body, source contents, or credentials.

## Verification

Automated Rust integration tests use a deterministic local fixture source and
test HTTP server. Test-only configuration may allow that loopback origin. The
end-to-end test proves initialization, network-message bridging, callback
delivery, pending Promise execution, and final URL validation. Tests also prove
that a disallowed origin is rejected and that output redaction excludes the
full resolved URL.

The live smoke command runs the existing `Huibq_lxmusic源` script against its
real upstream API with the selected Tencent track. The smoke passes only when
the source initializes and returns a syntactically valid HTTP or HTTPS playback
URL. External API availability is reported separately from deterministic test
results.

## Non-goals

- Replacing `SourceWorkerHost` or the production Node.js VM worker.
- Supporting all five installed source scripts.
- Implementing CryptoJS, pako, custom timers, updates, lyrics, or artwork.
- Persisting resolved URLs or changing source/database state.
- Modifying Docker, release, or deployment configuration.
- Treating successful compatibility as a production security review.
