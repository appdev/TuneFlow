# Hosted Web Leaderboards and Source Management Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hosted Web leaderboards load through the Service and let users enable, disable, and drag-order the installed custom-source fallback chain.

**Architecture:** Keep the renderer leaderboard store and desktop provider SDK behavior intact, but install a Web-only leaderboard adapter that sends validated request variants through the existing Web Runtime transport. Add a typed source-chain IPC mapped to `PUT /api/v1/sources/enabled`, keep the Service snapshot authoritative, and isolate list transformations in pure helpers used by the source-management modal.

**Tech Stack:** Vue 3, TypeScript/JavaScript, Pug, Vitest, SortableJS, Fastify Service APIs, Webpack, Docker.

## Global Constraints

- Preserve all existing unrelated dirty-worktree changes; touch only the files listed by this plan unless a directly related build or type failure proves another file necessary.
- Do not alter Service fallback selection, playback bundle scoring, download behavior, Flutter behavior, or local-first audio/lyrics/artwork resolution.
- Hosted Web uses the Service routes; desktop keeps direct provider SDK behavior and must not receive a new mandatory IPC dependency.
- The Service source snapshot is authoritative after every mutation; UI state must be replaced from the returned snapshot.
- Empty custom-source selection remains valid.
- Do not add dependencies.
- Do not commit or push unless the user separately authorizes Git publication.
- Deploy only after focused tests, lint for changed files, and `npm run build:web` pass; preserve the current Docker image/container state as rollback.

---

### Task 1: Web leaderboard Service adapter

**Files:**
- Create: `src/renderer/utils/musicSdk/webLeaderboard.ts`
- Create: `src/renderer/utils/musicSdk/webLeaderboard.test.ts`
- Modify: `src/renderer/utils/musicSdk/index.js`
- Modify: `src/web-runtime/rendererIpc.ts`
- Modify: `src/web-runtime/runtime.test.ts`

**Interfaces:**
- Consumes: `rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, params)` and existing Service routes `POST /api/v1/catalog/leaderboards` and `POST /api/v1/catalog/leaderboards/tracks`.
- Produces: `createWebLeaderboard(source, invoke)` with existing renderer-compatible `getBoards()` and `getList(boardId, page)` methods.
- Request variants:
  - `{ kind: 'provider-leaderboards', source: string }`
  - `{ kind: 'provider-leaderboard-tracks', source: string, boardId: string, page: number }`

- [ ] **Step 1: Add failing Web Runtime transport tests**

Add tests to `src/web-runtime/runtime.test.ts` that invoke `handle_request` with both variants and assert exact endpoint/payload mappings:

```ts
await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
  kind: 'provider-leaderboards', source: 'tx',
})
expect(fetch).toHaveBeenCalledWith('/api/v1/catalog/leaderboards', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'tx' }),
})

await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
  kind: 'provider-leaderboard-tracks', source: 'tx', boardId: '26', page: 2,
})
expect(fetch).toHaveBeenCalledWith('/api/v1/catalog/leaderboards/tracks', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'tx', boardId: '26', page: 2 }),
})
```

Also assert malformed/missing `source`, `boardId`, and non-positive/non-integer `page` reject locally with `UNSUPPORTED_IPC` and do not call `fetch`.

- [ ] **Step 2: Run the transport tests and confirm the new variants fail**

Run `npx vitest run src/web-runtime/runtime.test.ts`.

Expected: the new leaderboard cases fail because `handle_request` currently accepts only `provider-search`.

- [ ] **Step 3: Implement discriminated Web Runtime request validation**

Replace the search-only guard in `rendererIpc.ts` with an explicitly validated switch:

```ts
type ProviderRequest =
  | { kind: 'provider-search', source: string, text: string, page: number, limit: number }
  | { kind: 'provider-leaderboards', source: string }
  | { kind: 'provider-leaderboard-tracks', source: string, boardId: string, page: number }

switch (value.kind) {
  case 'provider-search':
    return request('POST', '/api/v1/catalog/tracks/search', {
      source: value.source, text: value.text, page: value.page, pageSize: value.limit,
    })
  case 'provider-leaderboards':
    return request('POST', '/api/v1/catalog/leaderboards', { source: value.source })
  case 'provider-leaderboard-tracks':
    return request('POST', '/api/v1/catalog/leaderboards/tracks', {
      source: value.source, boardId: value.boardId, page: value.page,
    })
  default:
    throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, 'UNSUPPORTED_IPC')
}
```

- [ ] **Step 4: Add failing adapter shape tests**

In `webLeaderboard.test.ts`, inject a fake invoke function and verify:

```ts
const adapter = createWebLeaderboard('tx', invoke)
await expect(adapter.getBoards()).resolves.toEqual({
  source: 'tx',
  list: [{ id: 'tx__26', bangid: '26', name: '热歌榜' }],
})
await adapter.getList('26', 2)
expect(invoke).toHaveBeenLastCalledWith(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
  kind: 'provider-leaderboard-tracks', source: 'tx', boardId: '26', page: 2,
})
```

Verify empty or malformed Service board fields reject instead of creating an unusable route ID.

- [ ] **Step 5: Run the adapter test and confirm it fails before implementation**

Run `npx vitest run src/renderer/utils/musicSdk/webLeaderboard.test.ts`.

Expected: FAIL because `createWebLeaderboard` does not exist.

- [ ] **Step 6: Implement and install the Web-only adapter**

Implement `createWebLeaderboard` as an injected adapter. It maps Service board items `{ id, providerId, name }` to `{ id, bangid: providerId, name }` and passes track pages through unchanged.

In `musicSdk/index.js`, inside the existing `globalThis.tuneFlowWebRuntime != null` block, override only sources that already have leaderboard capability:

```js
const leaderboard = sources[source.id]?.leaderboard
if (leaderboard) Object.assign(leaderboard, createWebLeaderboard(source.id, rendererInvoke))
```

This preserves auxiliary methods such as `getDetailPageUrl` and leaves desktop imports untouched.

- [ ] **Step 7: Run Task 1 tests**

Run `npx vitest run src/web-runtime/runtime.test.ts src/renderer/utils/musicSdk/webLeaderboard.test.ts`.

Expected: PASS, including all pre-existing Web Runtime cases.

---

### Task 2: Typed hosted-Web source-chain transport

**Files:**
- Modify: `src/common/ipcNames.ts`
- Modify: `src/common/types/user_api.d.ts`
- Modify: `src/renderer/utils/ipc.ts`
- Modify: `src/web-runtime/rendererIpc.ts`
- Modify: `src/web-runtime/runtime.test.ts`

**Interfaces:**
- Consumes: `PUT /api/v1/sources/enabled` with `{ sourceIds: string[] }`.
- Produces: `configureUserApiSources(sourceIds: string[]): Promise<TuneFlow.UserApi.UserApiInfo[]>`.
- Produces IPC name: `WIN_MAIN_RENDERER_EVENT_NAME.configure_user_api_sources`.

- [ ] **Step 1: Add a failing source-chain Web Runtime test**

Invoke the new IPC with `['user_api_a', 'user_api_b']`, assert the exact `PUT /api/v1/sources/enabled` request, and expect the returned full snapshot. Add rejection cases for non-array, duplicate, empty-string, and non-string IDs without calling `fetch`. An empty array is valid and must reach the Service.

- [ ] **Step 2: Run the focused transport test and confirm failure**

Run `npx vitest run src/web-runtime/runtime.test.ts`.

Expected: FAIL because the IPC name and handler do not exist.

- [ ] **Step 3: Add the typed IPC and renderer helper**

Add `configure_user_api_sources` to `WIN_MAIN_RENDERER_EVENT_NAME`, classify it as a Web route, and implement:

```ts
[WIN_MAIN_RENDERER_EVENT_NAME.configure_user_api_sources, async params => {
  if (!Array.isArray(params) ||
      !params.every(id => typeof id === 'string' && id.length > 0) ||
      new Set(params).size !== params.length) {
    throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.configure_user_api_sources, 'UNSUPPORTED_IPC')
  }
  return request('PUT', '/api/v1/sources/enabled', { sourceIds: params })
}]
```

Export the corresponding `configureUserApiSources` wrapper from `src/renderer/utils/ipc.ts`.

Extend `UserApiInfoFull` with compatibility-safe optional fields because the desktop transport may still return legacy objects:

```ts
active?: boolean
enabled?: boolean
priority?: number | null
```

- [ ] **Step 4: Run Task 2 tests**

Run `npx vitest run src/web-runtime/runtime.test.ts`.

Expected: PASS.

---

### Task 3: Source-chain list model and mutation semantics

**Files:**
- Create: `src/renderer/views/Setting/components/userApiSourceChain.ts`
- Create: `src/renderer/views/Setting/components/userApiSourceChain.test.ts`

**Interfaces:**
- Produces: `splitSourceChain(list)` returning `{ enabled, disabled }`.
- Produces: `toggleSource(enabledIds, sourceId, enabled)` returning the next ordered ID array.
- Produces: `moveSource(enabledIds, oldIndex, newIndex)` returning the reordered ID array.

- [ ] **Step 1: Write failing pure-model tests**

Cover these cases:

```ts
expect(splitSourceChain([
  { id: 'b', enabled: true, priority: 1 },
  { id: 'off', enabled: false, priority: null },
  { id: 'a', enabled: true, priority: 0 },
])).toMatchObject({ enabled: [{ id: 'a' }, { id: 'b' }], disabled: [{ id: 'off' }] })

expect(toggleSource(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c'])
expect(toggleSource(['a', 'b'], 'a', false)).toEqual(['b'])
expect(moveSource(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
```

Also verify duplicate enable is idempotent, disabling a missing ID is idempotent, invalid move indices return the unchanged order, and inputs are never mutated.

- [ ] **Step 2: Run the pure-model test and confirm failure**

Run `npx vitest run src/renderer/views/Setting/components/userApiSourceChain.test.ts`.

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the minimal immutable helpers**

Implement stable disabled ordering and numeric priority sorting. Treat only `enabled === true` with a non-negative integer `priority` as enabled; all legacy or malformed entries remain disabled instead of receiving an invented priority.

- [ ] **Step 4: Run Task 3 tests**

Run `npx vitest run src/renderer/views/Setting/components/userApiSourceChain.test.ts`.

Expected: PASS.

---

### Task 4: Hosted Web source-management UI

**Files:**
- Modify: `src/renderer/views/Setting/components/UserApiModal.vue`
- Modify: `src/renderer/views/Setting/components/SettingBasic.vue`
- Modify: `src/renderer/core/useApp/useInitUserApi.ts`
- Modify: `src/lang/zh-cn.json`
- Modify: `src/lang/zh-tw.json`
- Modify: `src/lang/en-us.json`
- Test: `src/renderer/views/Setting/components/userApiSourceChain.test.ts`

**Interfaces:**
- Consumes: `configureUserApiSources`, `splitSourceChain`, `toggleSource`, `moveSource`, and existing `useDrag`.
- Produces: Web-only enabled/disabled sections with serialized, Service-confirmed mutations.

- [ ] **Step 1: Add legacy-current synchronization tests**

Add and test a pure helper `nextLegacySource(enabledIds, builtInIds)`:

```ts
expect(nextLegacySource(['user_api_b', 'user_api_a'], ['kw'])).toBe('user_api_b')
expect(nextLegacySource([], ['kw', 'tx'])).toBe('kw')
expect(nextLegacySource([], [])).toBe('')
```

Run the helper test and confirm it fails, implement the function, then rerun to PASS.

- [ ] **Step 2: Render enabled and disabled sections**

In `UserApiModal.vue`, retain all existing metadata/import/remove behavior and add localized headings, `data-testid="enabled-source-list"`, `data-testid="disabled-source-list"`, an enabled switch per row, `data-testid="source-drag-<id>"`, a one-based priority label, and drag styling only for enabled rows. Add a clear empty-state label for each group.

Gate these controls on `globalThis.tuneFlowWebRuntime != null`; desktop keeps the existing flat management view.

- [ ] **Step 3: Serialize Service mutations and replace state from snapshots**

Use a single `saving` flag. Toggle and drag handlers follow this behavior:

```js
if (saving.value) return
const confirmed = [...userApi.list]
saving.value = true
try {
  userApi.list = await configureUserApiSources(nextIds)
  syncLegacySource(userApi.list)
} catch (error) {
  userApi.list = confirmed
  await dialog({ message: t('user_api__source_chain_save_failed', { message: error.message }) })
} finally {
  saving.value = false
}
```

Derive `nextIds` from the last confirmed snapshot. Disable switches, drag, import, and removal while saving so responses cannot arrive out of order.

- [ ] **Step 4: Synchronize legacy current-source behavior**

After a confirmed configure or remove snapshot, select the first enabled custom source, otherwise the first enabled built-in provider. Persist `common.apiSource` only when it differs. Do not use the legacy setting to derive the fallback chain.

During hosted Web initialization, load `getUserApiList()` before activating a custom source. When the snapshot has an enabled chain, use its priority-zero source for display and avoid promoting a stale persisted source. Desktop initialization retains its current behavior.

Update `SettingBasic.vue` labels so a custom source is marked current only when it is priority zero in the hosted Web snapshot. Built-in options and desktop status behavior remain unchanged.

- [ ] **Step 5: Add drag behavior using the existing composition**

Attach `useDrag` to the enabled list only. Its update callback calls `moveSource(currentEnabledIds, oldIndex, newIndex)` and submits the complete array. Set Sortable disabled while saving and when fewer than two sources are enabled. Disabled sources never enter the Sortable list.

- [ ] **Step 6: Add localized copy**

Add equivalent keys to `zh-cn`, `zh-tw`, and `en-us` for enabled sources, disabled sources, priority, enable source, drag to reorder, no enabled sources, and source-chain save failure. Do not leave a locale falling back to a raw key.

- [ ] **Step 7: Run focused tests and lint changed files**

Run:

```bash
npx vitest run src/renderer/views/Setting/components/userApiSourceChain.test.ts src/web-runtime/runtime.test.ts
npx eslint src/common/ipcNames.ts src/common/types/user_api.d.ts src/renderer/utils/ipc.ts src/web-runtime/rendererIpc.ts src/renderer/utils/musicSdk/webLeaderboard.ts src/renderer/utils/musicSdk/webLeaderboard.test.ts src/renderer/utils/musicSdk/index.js src/renderer/views/Setting/components/userApiSourceChain.ts src/renderer/views/Setting/components/userApiSourceChain.test.ts src/renderer/views/Setting/components/UserApiModal.vue src/renderer/views/Setting/components/SettingBasic.vue src/renderer/core/useApp/useInitUserApi.ts
```

Expected: tests PASS and ESLint exits 0.

---

### Task 5: Local integration verification and final diff review

**Files:**
- Verify only; modify a listed implementation/test file only when a failure is caused by this change.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-4.
- Produces: a locally verified production Web artifact and a frozen reviewed diff ready for deployment.

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
npx vitest run src/web-runtime/runtime.test.ts src/renderer/utils/musicSdk/webLeaderboard.test.ts src/renderer/views/Setting/components/userApiSourceChain.test.ts src/server/routes/catalog.test.ts src/server/sources/source.test.ts src/server/playback/bundleResolver.test.ts
```

Expected: PASS. If an unrelated pre-existing failure occurs, capture its exact test name and prove it is outside the changed paths before continuing.

- [ ] **Step 2: Build the production Web client**

Run `npm run build:web`.

Expected: exit 0 with no unresolved Node-only browser import introduced by the leaderboard adapter.

- [ ] **Step 3: Run a local Service/Web smoke test**

Build and run the service using project-native scripts, then verify:

```text
GET  /api/v1/health                              -> 200
POST /api/v1/catalog/leaderboards                -> non-empty TX/KW/WY lists
POST /api/v1/catalog/leaderboards/tracks         -> non-empty track pages
PUT  /api/v1/sources/enabled                     -> ordered snapshot
GET  /api/v1/sources                             -> persisted same order
```

Open the local Web client and verify the settings modal exposes enabled and disabled groups, a toggle, and drag ordering. Load one leaderboard and start a track; confirm the player queue contains subsequent ranking tracks and advances to the next item.

- [ ] **Step 4: Review and freeze the deployment diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/common/ipcNames.ts src/common/types/user_api.d.ts src/renderer/utils/ipc.ts src/web-runtime/rendererIpc.ts src/web-runtime/runtime.test.ts src/renderer/utils/musicSdk/index.js src/renderer/utils/musicSdk/webLeaderboard.ts src/renderer/utils/musicSdk/webLeaderboard.test.ts src/renderer/views/Setting/components/UserApiModal.vue src/renderer/views/Setting/components/SettingBasic.vue src/renderer/views/Setting/components/userApiSourceChain.ts src/renderer/views/Setting/components/userApiSourceChain.test.ts src/renderer/core/useApp/useInitUserApi.ts src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json
```

Confirm there are no debug logs, secrets, generated artifacts, unrelated edits, or accidental changes to the existing Service fallback/local-first code.

---

### Task 6: Docker deployment and deployed regression

**Files:**
- No repository changes expected; deployment state changes only after Task 5 passes.

**Interfaces:**
- Consumes: frozen locally verified worktree and the `deploy-qingyu-docker` workflow.
- Produces: healthy `tuneflow-web` deployment at the authorized host and a preserved rollback image/state.

- [ ] **Step 1: Read and follow the deployment skill**

Invoke `deploy-qingyu-docker`, inspect its `SKILL.md` completely, and perform its preflight. Resolve the exact current container, image, persistent mounts, environment/config, health endpoint, and rollback target before mutation. Do not expose secrets in output.

- [ ] **Step 2: Build and deploy the frozen workspace**

Deploy the locally verified workspace to the existing authorized Docker target used by this project. Preserve persistent data and the currently healthy image for rollback. Do not clean-install or delete prior state unless the deployment skill proves it necessary and the already authorized update path permits it.

- [ ] **Step 3: Verify container and Service health**

Confirm the new container reports healthy, has restart count zero, and serves the health, source list, leaderboard, leaderboard tracks, and playback resolve routes. If health or schema checks fail, use the preserved rollback state and report the evidence.

- [ ] **Step 4: Run deployed Web regression**

Using the in-app browser against the deployed Web URL:

1. Open TX, KW, and WY ranking pages and verify track rows load.
2. Start a ranking track and observe automatic advance to the next queued track.
3. Open custom-source management, enable at least three sources, drag-reorder, reload, and verify the same order persists.
4. Disable and re-enable one source and verify it appends to the end.
5. Play a track with local resources available and verify local audio, lyrics, and artwork remain preferred.
6. Inspect browser console/network for new uncaught errors and confirm leaderboard requests target `/api/v1/catalog/...`, not third-party provider endpoints.

- [ ] **Step 5: Final evidence report**

Report the deployed image/container identity, health result, test/build commands and pass counts, Web scenarios exercised, rollback state, any unverified edge, and residual risk. Do not claim automatic switching or local-first behavior unless runtime evidence directly demonstrates it.
