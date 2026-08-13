# Legacy Source Sandbox Timers Design

**Date:** 2026-08-13

## Goal

Allow legacy custom sources such as 六音音源 to initialize when they use
`setTimeout` and `clearTimeout`, without exposing Node.js timer functions or
other host-realm objects to the source VM.

## Scope

- Add sandbox-owned `setTimeout(callback, delay, ...args)` and
  `clearTimeout(id)` functions.
- Support function callbacks only. String callbacks remain forbidden.
- Do not add `setInterval`, `clearInterval`, direct Node globals, or dynamic
  code generation.
- Preserve the existing JSON-only boundary between the source VM and worker
  host.

## Design

The bootstrap running inside the VM owns timer identifiers, callback records,
and cancellation state. A timer request is emitted through the existing
outbound JSON queue. The worker creates the real host timer and later delivers
a timer-fire message back through a narrow bridge method. The VM looks up the
record, removes it before invocation, and invokes the callback inside the VM.

`clearTimeout` removes the VM record and emits a cancellation request. Unknown
or already-fired identifiers are harmless no-ops. Delay values are normalized
to a finite non-negative integer and capped at 60 seconds. At most 64 timers
may be pending for one source worker. Extra timers throw a source protocol
error.

Timer callbacks run through a `vm.Script` bridge call with the same short VM
execution timeout used for other bridge operations. Callback exceptions during
initialization are reported as initialization errors; later exceptions reset
the worker as protocol errors instead of escaping into the Service process.

The worker tracks host timer handles separately from the VM. All handles are
cleared when the worker exits. The host already terminates the worker after an
initialization timeout or protocol failure, so this also clears outstanding
source timers.

## Compatibility

The exposed API matches the browser behavior needed by 六音: asynchronous
function callbacks, optional delay, additional callback arguments, numeric
timer identifiers, and idempotent cancellation. This intentionally excludes
browser event-loop details that are not needed for source compatibility.

## Verification

1. Add a regression test whose source calls `setTimeout` before sending the
   initialized event; verify it fails on the current implementation.
2. Add cancellation and resource-limit tests.
3. Implement the minimal bridge and verify the focused source test suite.
4. Run the server source tests and relevant type/build checks.
5. Activate the locally stored 六音 script against the updated Service and
   confirm its reported capabilities.
6. If the LAN Service at `192.168.0.120:6124` has not been rebuilt with the
   change, report deployment as the remaining step rather than claiming remote
   success.

## Non-goals

- Fixing the CF source's exhausted upstream Cloudflare Worker quota.
- Expanding the sandbox with DOM, browser storage, fetch, Node modules, or
  unrestricted timers.
- Changing the source selection UI beyond what is necessary to verify 六音.
