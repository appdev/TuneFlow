# Legacy Source Sandbox Timers Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legacy sources such as 六音音源 initialize successfully when they use `setTimeout` and `clearTimeout`, while preserving the source VM's isolation from Node.js host objects.

**Architecture:** The VM bootstrap owns numeric timer IDs, callback functions, argument arrays, and its 64-timer admission limit. It emits JSON-only schedule/cancel messages; the worker thread owns the actual Node timer handles and dispatches fires back into the VM through a compiled `vm.Script` with a 2-second execution timeout. Dispatch installs a VM-realm fire function only for the synchronous dispatch step and removes the temporary global reference before the source callback runs.

**Tech Stack:** TypeScript, Node.js `worker_threads` and `vm`, Vitest.

## Global Constraints

- Support `setTimeout(callback, delay, ...args)` and `clearTimeout(id)` only.
- Reject string callbacks and do not add `setInterval`, `clearInterval`, direct Node globals, or dynamic code generation.
- Normalize delays to finite non-negative integers and cap them at 60,000 milliseconds.
- Allow at most 64 pending timers per source worker.
- Preserve the existing JSON-only source VM boundary.
- Clear all host timer handles when the worker exits.
- Do not commit, push, deploy, or modify the LAN service without separate authorization.

---

### Task 1: VM-owned timeout compatibility

**Files:**
- Modify: `src/server/sources/source.test.ts`
- Modify: `src/server/sources/worker.ts`

**Interfaces:**
- Consumes: existing `SourceWorkerHost.capabilities()` and worker bootstrap outbound JSON queue.
- Produces: sandbox globals `setTimeout(callback: Function, delay?: unknown, ...args: unknown[]): number` and `clearTimeout(id: unknown): void`; outbound messages `{ type: 'timer-schedule', id: number, delay: number }` and `{ type: 'timer-cancel', id: number }`; VM bridge method `fireTimer(raw: string): void`.

- [ ] **Step 1: Write the failing initialization regression test**

Add a source fixture that schedules initialization and verifies callback arguments:

```ts
it('initializes a legacy source through an isolated timeout callback', async() => {
  const timerSource = script('Timer compatibility', `
setTimeout((source, quality) => {
  window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, {
    sources: { [source]: { type: 'music', actions: ['musicUrl'], qualitys: [quality] } },
  })
}, 1, 'fixture', '320k')`)
  const host = new SourceWorkerHost({ id: 'timer-compatibility', ...parseSourceScript(timerSource), script: timerSource })
  hosts.push(host)

  await expect(host.capabilities()).resolves.toEqual({
    fixture: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] },
  })
})
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
npx vitest run src/server/sources/source.test.ts -t "initializes a legacy source through an isolated timeout callback"
```

Expected: FAIL with `ReferenceError: setTimeout is not defined`.

- [ ] **Step 3: Add VM timer records and sandbox functions**

In the bootstrap string, add:

```js
const MAX_TIMERS = 64;
const MAX_TIMER_DELAY = 60_000;
const timers = Object.create(null);
let timerSequence = 0;
const normalizeTimerDelay = value => {
  const delay = Number(value);
  if (!Number.isFinite(delay) || delay <= 0) return 0;
  return Math.min(Math.floor(delay), MAX_TIMER_DELAY);
};
const setTimeout = (callback, delay, ...args) => {
  if (typeof callback !== 'function') throw Object.assign(new TypeError('Timer callback must be a function'), { code: 'SOURCE_PROTOCOL_ERROR' });
  if (Object.keys(timers).length >= MAX_TIMERS) throw Object.assign(new Error('Too many pending source timers'), { code: 'SOURCE_PROTOCOL_ERROR' });
  const id = ++timerSequence;
  timers[id] = { callback, args };
  emit({ type: 'timer-schedule', id, delay: normalizeTimerDelay(delay) });
  return id;
};
const clearTimeout = id => {
  const timerId = Number(id);
  if (!numberIsSafeInteger(timerId) || timers[timerId] == null) return;
  delete timers[timerId];
  emit({ type: 'timer-cancel', id: timerId });
};
```

Assign both functions to `globalThis` after `window` is established. Extend the returned bridge with `fireTimer(raw)`, which parses `{ id }`, removes the record before invocation, and invokes the callback with its saved arguments.

- [ ] **Step 4: Add the host timer bridge with bounded callback execution**

In `worker.ts`:

```ts
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const TIMER_DISPATCH_KEY = '__tuneflowTimerDispatch__'
const timerDispatch = new vm.Script(`(() => {
  const fire = globalThis.${TIMER_DISPATCH_KEY}
  delete globalThis.${TIMER_DISPATCH_KEY}
  fire(globalThis.__tuneflowTimerPacket__)
  delete globalThis.__tuneflowTimerPacket__
})()`, { filename: 'tuneflow-timer-dispatch.js' })
```

When draining `timer-schedule`, create a host timeout using the normalized delay. When it fires, remove its handle, install the VM-realm `bridge.fireTimer` and JSON packet as temporary context properties, execute `timerDispatch.runInContext(context, { timeout: 2_000 })`, delete both temporary properties in `finally`, drain any resulting VM messages, and report failures as `init-error` before initialization or `timer-error` afterward. For `timer-cancel`, clear and remove the matching handle. Attach a worker-exit cleanup that clears all remaining handles.

- [ ] **Step 5: Run the initialization regression test and verify GREEN**

Run:

```bash
npx vitest run src/server/sources/source.test.ts -t "initializes a legacy source through an isolated timeout callback"
```

Expected: PASS.

---

### Task 2: Timer cancellation and resource boundaries

**Files:**
- Modify: `src/server/sources/source.test.ts`
- Modify: `src/server/sources/worker.ts`

**Interfaces:**
- Consumes: Task 1 sandbox timer functions and JSON timer bridge.
- Produces: idempotent cancellation, the 64-pending-timer limit, 60-second delay cap, and protocol-error propagation for rejected timer usage.

- [ ] **Step 1: Write failing cancellation and limit tests**

Add these behavioral cases:

```ts
it('cancels a sandbox timeout without invoking its callback', async() => {
  const source = script('Timer cancellation', `
const cancelled = setTimeout(() => { throw new Error('cancelled timer fired') }, 0)
clearTimeout(cancelled)
clearTimeout(cancelled)
setTimeout(() => window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, {
  sources: { fixture: { type: 'music', actions: ['musicUrl'], qualitys: [] } },
}), 1)`)
  const host = new SourceWorkerHost({ id: 'timer-cancellation', ...parseSourceScript(source), script: source })
  hosts.push(host)
  await expect(host.capabilities()).resolves.toHaveProperty('fixture')
})

it('rejects more than sixty-four pending sandbox timers', async() => {
  const source = script('Timer cap', `
for (let index = 0; index < 65; index++) setTimeout(() => {}, 60_000)
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: {} })`)
  const host = new SourceWorkerHost({ id: 'timer-cap', ...parseSourceScript(source), script: source })
  hosts.push(host)
  await expect(host.capabilities()).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
})

it('rejects string timeout callbacks without enabling dynamic code', async() => {
  const source = script('String timer rejection', `
setTimeout("window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: {} })", 0)`)
  const host = new SourceWorkerHost({ id: 'string-timer', ...parseSourceScript(source), script: source })
  hosts.push(host)
  await expect(host.capabilities()).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
})
```

- [ ] **Step 2: Run the three boundary tests and verify RED where behavior is incomplete**

Run:

```bash
npx vitest run src/server/sources/source.test.ts -t "sandbox timeout|pending sandbox timers|string timeout callbacks"
```

Expected: at least one new test FAILS because cancellation, error mapping, or admission limiting is incomplete.

- [ ] **Step 3: Complete lifecycle and error propagation**

Ensure bootstrap evaluation errors preserve their `SOURCE_PROTOCOL_ERROR` code in `init-error`. Extend `WorkerBridge` and worker messages without `any` for timer fields. On a post-initialization `timer-error`, make `SourceWorkerHost` reset the active worker so future requests cannot continue with corrupted source state. Keep unknown timer cancellations as no-ops.

- [ ] **Step 4: Run the boundary tests and focused source suite**

Run:

```bash
npx vitest run src/server/sources/source.test.ts -t "sandbox timeout|pending sandbox timers|string timeout callbacks"
npx vitest run src/server/sources/source.test.ts
```

Expected: all selected tests and the full source test file PASS with zero unhandled errors.

---

### Task 3: Real 六音 compatibility and final verification

**Files:**
- Modify only if the real script exposes an uncovered compatibility bug: `src/server/sources/source.test.ts`
- Modify only to fix that proven bug: `src/server/sources/worker.ts`
- Read: `/Users/ying/Library/Application Support/lx-music-desktop/LxDatas/user_api.json`

**Interfaces:**
- Consumes: desktop source storage's gzip-compressed `script` value and `SourceWorkerHost.capabilities()`.
- Produces: runtime evidence that the actual 六音 script initializes and advertises valid source capabilities on the updated local code.

- [ ] **Step 1: Locate or import the exact 六音 script**

Search the desktop source store by `name === '六音音源'`. If absent, read the already installed source from an authorized local Service data directory or export it through the UI. Do not add the third-party source script to Git or print its full contents.

- [ ] **Step 2: Run a local real-script activation probe**

Use a temporary, ignored script that inflates the `gz_` value when necessary, constructs `SourceWorkerHost` with the exact source, calls `capabilities()`, prints only source names/actions/qualities, and closes the host. Run it with the repository's `tsx` runtime.

Expected: 六音 initializes within 15 seconds and returns at least one valid music source capability. If it fails, capture only the error code/message, write a minimal failing regression fixture for the newly discovered missing behavior, and repeat the Task 1 red-green cycle before proceeding.

- [ ] **Step 3: Run final frozen-tree checks**

Run:

```bash
npx vitest run src/server/sources/source.test.ts src/server/sources/worker-host.test.ts --passWithNoTests
npx tsc -p tsconfig.json --noEmit
npm run build:server
git diff --check
```

If `worker-host.test.ts` does not exist, `--passWithNoTests` keeps the explicit command valid while `source.test.ts` remains the behavioral gate. Expected: every command exits 0.

- [ ] **Step 4: Review final scope and report deployment boundary**

Inspect `git diff -- src/server/sources/worker.ts src/server/sources/source.test.ts docs/superpowers/specs/2026-08-13-sandbox-timers-for-legacy-sources-design.md docs/superpowers/plans/2026-08-13-sandbox-timers-for-legacy-sources.md` and `git status --short`. Confirm there are no unrelated edits, debug prints, source-script contents, credentials, or generated artifacts.

Report local verification separately from the LAN instance. Do not rebuild, deploy, or restart `192.168.0.120:6124` without explicit deployment authorization.
