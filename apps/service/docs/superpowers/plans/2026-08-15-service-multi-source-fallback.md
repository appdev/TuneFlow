# Service Multi-Source Fallback Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Service persist an ordered set of enabled source scripts and resolve local-first audio, lyrics, and artwork through a request-scoped multi-source fallback chain with complete-resource preference.

**Architecture:** `SourceRepository` owns ordered selection persistence, while `SourcesService` exposes immutable capability-filtered snapshots. A generic fallback runner classifies trusted transient failures, and a playback bundle resolver combines local resources, source actions, bounded media probes, and cross-provider alternatives. Playback tokens and downloads consume the same selected bundle; the public API remains backward compatible.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Fastify 5, TypeBox, better-sqlite3, Undici, Vitest 4, `image-size`, `music-metadata`.

## Global Constraints

- Preserve Service-owned local audio, local lyrics, and local artwork ahead of every online source.
- Fallback is request-scoped; every new request starts from configured priority zero.
- User order is authoritative; never persist automatic promotion, health score, or circuit-breaker state.
- Prefer one online source with usable audio, lyrics, and artwork; after a four-second enrichment budget, compose the best validated components.
- Use a named sub-second hedge delay so backup bundle evaluations can run within the total budget while final selection still honors A, B, C priority.
- Only trusted Service network/worker timeout failures and validated resource-unavailability failures may cross to another script.
- Script, protocol, safety, size-limit, invalid-input, and cancellation failures are terminal.
- Never splice audio bytes from two sources or track candidates into one response or download file.
- Never expose or log resolved URLs, headers, cookies, source scripts, lyric bodies, or artwork bytes.
- Keep `web_source_state.active_source_id` synchronized with priority zero for rollback and old-client compatibility.
- Do not add a runtime dependency; use the existing `image-size`, Undici, and `music-metadata` packages.
- Preserve unrelated dirty-worktree changes. Existing local library/resource edits are user-owned and must be integrated rather than overwritten.
- Commit steps are intended review boundaries. Run them only if the execution request explicitly authorizes commits; otherwise leave the verified changes uncommitted.
- Authoritative design: `docs/superpowers/specs/2026-08-15-multi-source-fallback-design.md`.

---

## File Structure

**Create**

- `src/server/sources/fallback.ts` — generic ordered attempt runner and safe diagnostics.
- `src/server/sources/fallback.test.ts` — retry, terminal, order, and cancellation tests.
- `src/server/playback/mediaClient.ts` — DNS-pinned bounded media open, audio probe, and artwork validation.
- `src/server/playback/mediaClient.test.ts` — HTTP, Range, content, timeout, and SSRF tests.
- `src/server/playback/resourceStore.ts` — bounded TTL artwork resource cache.
- `src/server/playback/resourceStore.test.ts` — expiry, capacity, and byte-accounting tests.
- `src/server/playback/bundleResolver.ts` — local-first complete/mixed/audio-only bundle selection.
- `src/server/playback/bundleResolver.test.ts` — bundle priority, budget, alternatives, and cancellation tests.

**Modify**

- `src/server/sources/{types.ts,repository.ts,network.ts,worker.ts,worker-host.ts,source.test.ts}`.
- `src/server/routes/{sources.ts,playback.ts,catalog.ts,catalog.test.ts}`.
- `src/server/api/{schemas/domain.ts,openapi.test.ts}`.
- `src/server/playback/{resolver.ts,tokenStore.ts,proxy.ts,proxy.test.ts}`.
- `src/server/downloads/{types.ts,manager.ts,metadata.ts,downloads.test.ts}`.
- `src/server/app.ts`, `src/web-runtime/runtime.test.ts`, and `docs/server-web.md`.

---

### Task 1: Persist Ordered Enabled Sources

**Files:**
- Modify: `src/server/sources/types.ts`
- Modify: `src/server/sources/repository.ts`
- Test: `src/server/sources/source.test.ts`

**Interfaces:**
- Consumes: existing `web_sources` and `web_source_state.active_source_id`.
- Produces: `SourceSummary.enabled`, `SourceSummary.priority`, `SourceRepository.setEnabledSourceIds(ids)`, and `SourceRepository.promoteSource(id)`.

- [ ] **Step 1: Add failing migration and ordering tests**

Create two installed sources, seed the legacy active ID, reconstruct the repository, and assert:

```ts
expect(repository.listSources().map(({ id, active, enabled, priority }) => ({ id, active, enabled, priority }))).toEqual([
  { id: first.id, active: false, enabled: false, priority: null },
  { id: second.id, active: true, enabled: true, priority: 0 },
])

repository.setEnabledSourceIds([first.id, second.id])
expect(repository.listSources().map(source => [source.id, source.enabled, source.priority, source.active])).toEqual([
  [first.id, true, 0, true],
  [second.id, true, 1, false],
])
```

Also cover duplicate/unknown IDs, an empty list, promotion preserving relative order, deletion compaction, and no mutation after validation failure.

- [ ] **Step 2: Run the focused tests and confirm failure**

```bash
npx vitest run src/server/sources/source.test.ts -t "migrates the legacy active source|persists ordered enabled sources|promotes without clearing backups|compacts selection"
```

Expected: FAIL because ordered state does not exist.

- [ ] **Step 3: Extend public source types**

```ts
export interface SourceSummary extends SourceInfo {
  active: boolean
  enabled: boolean
  priority: number | null
  sources?: Record<string, { type: 'music', actions: SourceAction[], qualitys: string[] }>
}
```

- [ ] **Step 4: Create and migrate `web_source_selection`**

Create `source_id TEXT PRIMARY KEY REFERENCES web_sources(id) ON DELETE CASCADE` and unique non-negative `position`. In one transaction, seed the valid legacy active source at position zero only when the selection table is empty.

- [ ] **Step 5: Implement atomic mutations and derived summaries**

```ts
setEnabledSourceIds(ids: string[]): SourceSummary[]
promoteSource(id: string): SourceSummary
```

Validate the full array before mutation, rewrite contiguous positions in one transaction, mirror `ids[0] ?? null` into the legacy table, derive `enabled/priority/active` from the join, and compact positions after deletion.

- [ ] **Step 6: Verify Task 1**

```bash
npx vitest run src/server/sources/source.test.ts
npx eslint src/server/sources/types.ts src/server/sources/repository.ts src/server/sources/source.test.ts
```

Expected: PASS and lint exit 0.

- [ ] **Step 7: Commit when authorized**

```bash
git add src/server/sources/types.ts src/server/sources/repository.ts src/server/sources/source.test.ts
git commit -m "feat(sources): persist ordered enabled sources"
```

### Task 2: Add Atomic Source-Chain API and Compatibility Promotion

**Files:**
- Modify: `src/server/routes/sources.ts`
- Modify: `src/server/api/schemas/domain.ts`
- Modify: `src/server/sources/source.test.ts`
- Modify: `src/server/api/openapi.test.ts`
- Modify: `src/web-runtime/runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 repository methods.
- Produces: `SourcesService.configureEnabled`, `SourcesService.promote`, and `PUT /api/v1/sources/enabled`.

- [ ] **Step 1: Write failing service and route tests**

```ts
const response = await app.inject({
  method: 'PUT', url: '/api/v1/sources/enabled',
  payload: { sourceIds: [second.id, first.id] },
})
expect(response.statusCode).toBe(200)
expect(response.json().data.filter((item: any) => item.enabled).map((item: any) => item.id))
  .toEqual([second.id, first.id])

await app.inject({ method: 'PUT', url: '/api/v1/sources/active', payload: { sourceId: first.id } })
expect(service.list().filter(item => item.enabled).map(item => item.id)).toEqual([first.id, second.id])
```

Assert initialization failure leaves the old order unchanged and emits no update. Cover duplicates, unknown IDs, additional properties, and an empty array.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npx vitest run src/server/sources/source.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts -t "enabled source chain|promotes|complete API|active-source"
```

Expected: FAIL because the route and fields are absent.

- [ ] **Step 3: Serialize full-array configuration writes**

```ts
private configurationTail: Promise<void> = Promise.resolve()

private serializeConfiguration<T>(work: () => Promise<T>): Promise<T> {
  const result = this.configurationTail.then(work, work)
  this.configurationTail = result.then(() => {}, () => {})
  return result
}
```

Initialize newly enabled workers and store their capabilities before committing. Disabled workers remain cached but cannot enter new snapshots.

- [ ] **Step 4: Add exact closed request/response schemas**

```ts
Type.Object({
  sourceIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
}, { additionalProperties: false })
```

Return the complete list, emit one `sources.updated`, require `enabled` and nullable `priority` in summaries, and keep `active` as priority-zero compatibility state.

- [ ] **Step 5: Verify Task 2**

```bash
npx vitest run src/server/sources/source.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
npx eslint src/server/routes/sources.ts src/server/api/schemas/domain.ts src/server/sources/source.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
```

Expected: PASS and OpenAPI operation ID `configureEnabledSources` is unique.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/server/routes/sources.ts src/server/api/schemas/domain.ts src/server/sources/source.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
git commit -m "feat(api): configure an ordered source chain"
```

### Task 3: Preserve Trusted Failure Provenance and Run Ordered Attempts

**Files:**
- Create: `src/server/sources/fallback.ts`
- Create: `src/server/sources/fallback.test.ts`
- Modify: `src/server/sources/types.ts`
- Modify: `src/server/sources/network.ts`
- Modify: `src/server/sources/worker.ts`
- Modify: `src/server/sources/worker-host.ts`
- Modify: `src/server/routes/sources.ts`
- Modify: `src/server/sources/source.test.ts`

**Interfaces:**
- Consumes: ordered enabled summaries.
- Produces: `SourceFailureOrigin`, `SourceCandidate`, `SourceAttempt`, `runSourceFallback<T>`, and `SourcesService.snapshot(provider, action)`.

- [ ] **Step 1: Add failing provenance and runner tests**

Cover strict order, capability skips, trusted timeout/network retry, terminal script/protocol errors, cancellation, safe diagnostics, and a script forging the string `SOURCE_NETWORK_ERROR`.

```ts
await expect(runSourceFallback({
  candidates: [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
  action: 'musicUrl',
  attempt: async candidate => candidate.id === 'a'
    ? Promise.reject(new SourceServiceError('SOURCE_NETWORK_ERROR', 'offline', 'service-network'))
    : { url: 'https://b.test/audio' },
})).resolves.toMatchObject({ sourceId: 'b' })
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/sources/fallback.test.ts src/server/sources/source.test.ts -t "trusted|forged|ordered fallback|cancellation"
```

Expected: FAIL because origin metadata and the runner are absent.

- [ ] **Step 3: Add trusted error origin**

```ts
export type SourceFailureOrigin = 'service-network' | 'worker-timeout' | 'caller' | 'script' | 'protocol' | 'safety'

export class SourceServiceError extends Error {
  constructor(readonly code: string, message = code, readonly origin: SourceFailureOrigin = 'protocol') {
    super(message)
  }
}
```

Wrap unknown transport exceptions as `SOURCE_NETWORK_ERROR/service-network`; retain `SOURCE_TIMEOUT/worker-timeout`; tag cancellation and safety at creation.

- [ ] **Step 4: Preserve identity across the worker without trusting script codes**

Keep Service network Error objects in a closure-private `WeakSet` inside the worker runtime. Emit `origin: 'service-network'` only when the exact top-level rejected object belongs to that set; otherwise emit `origin: 'script'`. The host reconstructs only wrapper-provided origin.

- [ ] **Step 5: Implement snapshot and generic runner**

```ts
export interface SourceCandidate { id: string, priority: number }
export interface SourceAttempt {
  sourceId: string
  action: string
  code: string
  elapsedMs: number
}
export interface SourceAttemptLog extends SourceAttempt {
  requestId: string
  priority: number
}
export interface SourceFallbackResult<T> { sourceId: string, value: T, attempts: SourceAttempt[] }

export async function runSourceFallback<T>(input: {
  candidates: readonly SourceCandidate[]
  action: string
  requestId?: string
  signal?: AbortSignal
  now?: () => number
  onAttempt?: (attempt: SourceAttemptLog) => void
  attempt: (candidate: SourceCandidate, signal?: AbortSignal) => Promise<T>
}): Promise<SourceFallbackResult<T>>
```

Generate `requestId` with `randomUUID()` when the caller does not provide one. Invoke `onAttempt` once per completed attempt with only the fields in `SourceAttemptLog`; never include messages, URLs, headers, bodies, cookies, or script-returned data. Keep `requestId` and priority out of the public exhaustion payload. Retry only trusted network/timeout origins. Exhaustion throws `ApiError(502, 'SOURCE_ALL_UNAVAILABLE', ..., { attempts })`. `SourcesService.snapshot` returns a frozen enabled/ordered/capable array.

- [ ] **Step 6: Verify Task 3**

```bash
npx vitest run src/server/sources/fallback.test.ts src/server/sources/source.test.ts
npx eslint src/server/sources/fallback.ts src/server/sources/fallback.test.ts src/server/sources/types.ts src/server/sources/network.ts src/server/sources/worker.ts src/server/sources/worker-host.ts src/server/routes/sources.ts
```

Expected: PASS; attempt details contain no thrown message, URL, headers, or body.

- [ ] **Step 7: Commit when authorized**

```bash
git add src/server/sources/fallback.ts src/server/sources/fallback.test.ts src/server/sources/types.ts src/server/sources/network.ts src/server/sources/worker.ts src/server/sources/worker-host.ts src/server/routes/sources.ts src/server/sources/source.test.ts
git commit -m "feat(sources): add trusted ordered fallback"
```

### Task 4: Build a Bounded Media Client and Artwork Store

**Files:**
- Create: `src/server/playback/mediaClient.ts`
- Create: `src/server/playback/mediaClient.test.ts`
- Create: `src/server/playback/resourceStore.ts`
- Create: `src/server/playback/resourceStore.test.ts`
- Modify: `src/server/playback/proxy.ts`
- Modify: `src/server/playback/proxy.test.ts`

**Interfaces:**
- Consumes: `isBlockedAddress` and current proxy safety behavior.
- Produces: `MediaTarget`, `MediaClient`, and `PlaybackResourceStore`.

- [ ] **Step 1: Add failing media/resource tests**

Cover DNS pinning, redirects, 200/206, invalid Range, retryable HTTP statuses, ignored Range capped at 64 KiB, empty/HTML/JSON bodies, declared-length truncation, timeout, cancellation, private targets, valid/invalid pictures, five-minute expiry, 256 entries, and 32 MiB total cache bytes.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement one DNS-pinned media primitive**

```ts
export interface MediaTarget { url: string, headers?: Record<string, string> }
export interface OpenMediaRequest { method: 'GET' | 'HEAD', range?: string, ifRange?: string, signal?: AbortSignal }
import type { Readable } from 'node:stream'

export interface OpenMediaResponse {
  statusCode: number
  headers: Record<string, string>
  body: Readable
  close: () => void
}

export class MediaClient {
  open(target: MediaTarget, request: OpenMediaRequest): Promise<OpenMediaResponse>
  probeAudio(target: MediaTarget, signal?: AbortSignal): Promise<void>
  fetchArtwork(target: MediaTarget, signal?: AbortSignal): Promise<{ bytes: Uint8Array, mimeType: string }>
}
```

Move redirect/DNS/timeout/protocol mechanics from `proxy.ts` into `open`, retaining response-header allowlisting at the proxy.

- [ ] **Step 4: Implement exact bounded validation**

`probeAudio` requests `bytes=0-65535`, reads no more than 65,536 bytes, closes a full 200 response at that limit, validates `Content-Range`, and rejects obvious text/JSON errors. `fetchArtwork` caps at 5 MiB and validates format with existing `image-size` plus MIME/signature checks.

- [ ] **Step 5: Implement opaque picture storage**

```ts
export interface StoredPicture { bytes: Uint8Array, mimeType: string, expiresAt: number }
export class PlaybackResourceStore {
  putPicture(value: Omit<StoredPicture, 'expiresAt'>): { token: string, expiresAt: number }
  getPicture(token: string): StoredPicture | undefined
}
```

Use random 32-byte hex tokens, five-minute TTL, oldest-entry pruning, 256-entry/32-MiB caps, and defensive byte copies.

- [ ] **Step 6: Refactor the proxy through `MediaClient.open`**

Keep existing GET, HEAD, Range, headers, FLAC normalization, maximum stream size, and token expiry behavior unchanged; multi-candidate behavior comes in Task 6.

- [ ] **Step 7: Verify Task 4**

```bash
npx vitest run src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.test.ts src/server/playback/proxy.test.ts
npx eslint src/server/playback/mediaClient.ts src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.ts src/server/playback/resourceStore.test.ts src/server/playback/proxy.ts src/server/playback/proxy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit when authorized**

```bash
git add src/server/playback/mediaClient.ts src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.ts src/server/playback/resourceStore.test.ts src/server/playback/proxy.ts src/server/playback/proxy.test.ts
git commit -m "feat(playback): validate bounded media resources"
```

### Task 5: Resolve Local-First Complete and Mixed Bundles

**Files:**
- Create: `src/server/playback/bundleResolver.ts`
- Create: `src/server/playback/bundleResolver.test.ts`
- Modify: `src/server/playback/resolver.ts`
- Modify: `src/server/playback/tokenStore.ts`
- Modify: `src/server/api/schemas/domain.ts`
- Test: `src/server/playback/proxy.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4, built-in alternative/lyric/picture functions, and local library matches.
- Produces: `PlaybackBundleResolver.resolve`, `PlaybackBundle`, extended `ResolvedTrack`, and multi-candidate playback tokens.

- [ ] **Step 1: Add failing bundle tests**

```ts
expect(localBundle.audioKind).toBe('local')
expect(requestSource).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'musicUrl' }), expect.anything())

expect(complete.sourceIds).toEqual({ audio: 'b', lyrics: 'b', picture: 'b' })
expect(complete.completeness).toBe('complete')

expect(mixed.sourceIds).toEqual({ audio: 'a', lyrics: 'b', picture: 'c' })
expect(mixed.completeness).toBe('mixed')
```

Also cover audio-only, missing capabilities, terminal errors, trusted fallback, original track before alternatives, fake-clock budget/hedging, cancellation of losers, and local audio supplemented without replacement.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/playback/bundleResolver.test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Define bundle types used by every later task**

```ts
export type BundleCompleteness = 'complete' | 'mixed' | 'audio-only'
export interface StreamCandidate { sourceId: string, url: string, headers?: Record<string, string> }
export interface PlaybackResources {
  lyrics?: { lyric: string, tlyric?: string | null, rlyric?: string | null, verbatimLyric?: string | null }
  lyricsUrl?: string
  pictureUrl?: string
}
export interface PlaybackBundle {
  audioKind: 'local' | 'online'
  streamUrl?: string
  streamCandidates: StreamCandidate[]
  resources: PlaybackResources
  completeness: BundleCompleteness
  sourceIds: { audio: string, lyrics?: string, picture?: string }
}
```

Local audio uses `streamUrl`; online audio puts the selected candidate first and other validated candidates afterward.

- [ ] **Step 4: Implement bounded staggered evaluation**

Inject clock/timer dependencies. Set `BUNDLE_ENRICHMENT_BUDGET_MS = 4_000` and `BUNDLE_HEDGE_DELAY_MS = 500`. Start sources in priority order with the hedge delay; choose the lowest-priority-number complete source only after earlier sources are incomplete or the total budget expires. Cancel losing enrichment and retain validated components for mixed fallback.

- [ ] **Step 5: Preserve local and track-candidate ordering**

```ts
export interface LocalPlaybackMatch {
  streamUrl: string
  pictureUrl?: string
  lyricsUrl?: string
}
```

Return local audio before online actions. Fill only missing local enrichment. Fully evaluate the original online track candidate before calling `findAlternativeMusic`, then evaluate alternatives one by one.

- [ ] **Step 6: Extend token storage and the resolver response**

Change token creation to `create({ candidates: StreamCandidate[] }): string`, normalize headers per candidate, and return:

```ts
{
  url,
  quality,
  expiresAt,
  resources: bundle.resources,
  completeness: bundle.completeness,
}
```

Keep local stream paths direct. Online paths remain opaque tokens.

- [ ] **Step 7: Add closed TypeBox response schemas**

Add optional `resources` and `completeness`. Implementation enforces mutually exclusive `lyrics`/`lyricsUrl`. Do not expose internal `sourceIds` or resolved targets.

- [ ] **Step 8: Verify Task 5**

```bash
npx vitest run src/server/playback/bundleResolver.test.ts src/server/playback/proxy.test.ts
npx eslint src/server/playback/bundleResolver.ts src/server/playback/bundleResolver.test.ts src/server/playback/resolver.ts src/server/playback/tokenStore.ts src/server/api/schemas/domain.ts
```

Expected: PASS; existing local-first tests remain green.

- [ ] **Step 9: Commit when authorized**

```bash
git add src/server/playback/bundleResolver.ts src/server/playback/bundleResolver.test.ts src/server/playback/resolver.ts src/server/playback/tokenStore.ts src/server/api/schemas/domain.ts src/server/playback/proxy.test.ts
git commit -m "feat(playback): resolve complete source bundles"
```

### Task 6: Fail Over Streams Before Bytes and Serve Artwork

**Files:**
- Modify: `src/server/playback/proxy.ts`
- Modify: `src/server/routes/playback.ts`
- Modify: `src/server/playback/proxy.test.ts`
- Modify: `src/server/api/openapi.test.ts`

**Interfaces:**
- Consumes: multi-candidate tokens, `MediaClient`, and `PlaybackResourceStore`.
- Produces: pre-byte stream fallback and `GET/HEAD /api/v1/playback/resources/:token/picture`.

- [ ] **Step 1: Add failing proxy/resource route tests**

Assert A returning 503 before reply causes B to stream, A disconnecting after bytes never appends B, Range/HEAD remain correct, cancellation stops remaining attempts, expired artwork returns 410, and picture bytes/MIME are exact.

```ts
expect(response.rawPayload).toEqual(audioFromB)
expect(Buffer.concat([audioFromA, audioFromB]).equals(response.rawPayload)).toBe(false)
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/playback/proxy.test.ts src/server/api/openapi.test.ts -t "candidate|picture resource|complete API"
```

Expected: FAIL because tokens contain one URL and the route is absent.

- [ ] **Step 3: Retry candidates only before reply commitment**

For each candidate, call `MediaClient.open` and validate status/Range before `reply.code`, headers, or `reply.send`. Retry only typed availability failures. Once headers or body are committed, propagate later failure and never open the next candidate.

- [ ] **Step 4: Add the picture route**

Return cached bytes with exact MIME/length and `cache-control: private, max-age=300`. Return status 410 with `PLAYBACK_RESOURCE_EXPIRED` when absent; never include an upstream target.

- [ ] **Step 5: Update OpenAPI paths and resolve fields**

Add the new GET/HEAD path and assert resolve exposes only `url`, `quality`, `expiresAt`, optional `resources`, and optional `completeness`.

- [ ] **Step 6: Verify Task 6**

```bash
npx vitest run src/server/playback/proxy.test.ts src/server/api/openapi.test.ts
npx eslint src/server/playback/proxy.ts src/server/routes/playback.ts src/server/playback/proxy.test.ts src/server/api/openapi.test.ts
```

Expected: PASS with no URL/header leakage regressions.

- [ ] **Step 7: Commit when authorized**

```bash
git add src/server/playback/proxy.ts src/server/routes/playback.ts src/server/playback/proxy.test.ts src/server/api/openapi.test.ts
git commit -m "feat(playback): fail over safe stream candidates"
```

### Task 7: Apply Ordered Fallback to Catalog Resources

**Files:**
- Modify: `src/server/routes/catalog.ts`
- Modify: `src/server/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `SourcesService.snapshot`, `runSourceFallback`, media artwork validation, and resource storage.
- Produces: resource-specific A, B, C fallback for lyric and picture endpoints.

- [ ] **Step 1: Add failing catalog tests**

Cover A network failure then B success, A terminal failure blocking B, unsupported A skipped, no capable script using built-in behavior, replacement characters remaining terminal, and picture returning an opaque same-origin URL after byte validation.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/routes/catalog.test.ts -t "ordered source|terminal source|opaque picture|built-in"
```

Expected: FAIL because `activeSourceFor` selects one script.

- [ ] **Step 3: Replace the single-active lookup**

For lyrics, snapshot capable sources and call each through `runSourceFallback`; keep replacement-character rejection terminal. When the snapshot is empty, call built-in `getLyric` once. For artwork, validate/fetch each returned URL, store bytes, and return a same-origin resource URL; apply the same media boundary to built-in artwork.

- [ ] **Step 4: Verify Task 7**

```bash
npx vitest run src/server/routes/catalog.test.ts
npx eslint src/server/routes/catalog.ts src/server/routes/catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit when authorized**

```bash
git add src/server/routes/catalog.ts src/server/routes/catalog.test.ts
git commit -m "feat(catalog): fall back across enabled sources"
```

### Task 8: Restart Downloads with Bundle Resources and Audio Validation

**Files:**
- Modify: `src/server/downloads/types.ts`
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/metadata.ts`
- Modify: `src/server/downloads/downloads.test.ts`

**Interfaces:**
- Consumes: bundle audio candidates/resources and existing finalization/integrity machinery.
- Produces: whole-file source retries and metadata that reuses validated bundle data.

- [ ] **Step 1: Add failing download tests**

Create A that declares a longer body then disconnects and B that returns a parseable audio fixture. Assert exact source order, final bytes only from B, `.part` cleanup, cancellation not trying B, invalid audio trying B, and metadata not refetching selected resources.

```ts
expect(requestedSources).toEqual(['a', 'b'])
expect(readFileSync(finalPath)).toEqual(bytesFromB)
expect(existsSync(partPath)).toBe(false)
expect(manager.expectedIntegrity(finalPath)).toEqual({
  size: statSync(finalPath).size,
  sha256: createHash('sha256').update(readFileSync(finalPath)).digest('hex'),
})
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npx vitest run src/server/downloads/downloads.test.ts -t "next source|parseable audio|bundle metadata|does not mix"
```

Expected: FAIL because one URL is resolved and parseability is not a completion gate.

- [ ] **Step 3: Extend the internal resolved download type**

```ts
export interface ResolvedDownload {
  candidates: Array<{ sourceId: string, url: string, headers?: Record<string, string> }>
  resources?: {
    pictureBytes?: Uint8Array
    pictureMimeType?: string
    lyrics?: TuneFlow.Music.LyricInfo
  }
}
```

Never persist candidates, URLs, or headers in `DownloadJobRecord`.

- [ ] **Step 4: Retry candidates inside each quality**

On retryable transfer failure, close response/writer, remove only the validated `.part` path, clear progress/validators, and restart the next source at byte zero. Cancellation and terminal errors exit. Only after candidate exhaustion does existing quality fallback run.

- [ ] **Step 5: Require parseable audio before publication**

After byte-count validation and before rename, call `parseFile(part, { duration: false, skipCovers: true })` and require non-empty container and codec. Treat parse failure as resource unavailability for this candidate. Preserve fsync, publication markers, metadata, derived resources, and final SHA-256.

- [ ] **Step 6: Reuse bundle metadata**

Extend metadata dependencies to accept validated artwork bytes/MIME and lyrics directly. MP3/FLAC embedding and LRC generation must not refetch a URL when bundle data is present; settings that disable embedding remain authoritative.

- [ ] **Step 7: Verify Task 8**

```bash
npx vitest run src/server/downloads/downloads.test.ts
npx eslint src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/metadata.ts src/server/downloads/downloads.test.ts
```

Expected: PASS, including existing crash recovery and adoption tests.

- [ ] **Step 8: Commit when authorized**

```bash
git add src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/metadata.ts src/server/downloads/downloads.test.ts
git commit -m "feat(downloads): retry complete files across sources"
```

### Task 9: Wire Production Dependencies and Document Behavior

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/routes/playback.ts`
- Modify: `src/server/routes/catalog.ts`
- Modify: `src/server/api/openapi.test.ts`
- Modify: `docs/server-web.md`

**Interfaces:**
- Consumes: Tasks 1–8 and `LibraryScanner.findMatchingFile`.
- Produces: production composition root and frozen Flutter-facing contract.

- [ ] **Step 1: Add a failing server-level integration test**

Install/configure A and B fixtures, make A transiently fail, and assert resolve returns B-backed opaque audio/resources without leaking targets. Add a local match and assert no online audio attempt plus local `pictureUrl/lyricsUrl` propagation.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/server/playback/proxy.test.ts src/server/api/openapi.test.ts -t "configured source chain|local resource bundle"
```

Expected: FAIL until production injection is complete.

- [ ] **Step 3: Construct shared services once**

Construct one `MediaClient`, `PlaybackResourceStore`, and `PlaybackBundleResolver` in `createServer`; inject them into playback, catalog, and downloads. Supply `runSourceFallback.onAttempt` with a callback that writes only the typed `SourceAttempt` object to `app.log.info({ sourceAttempt: attempt })`. Local lookup returns:

```ts
const match = await library.findMatchingFile(musicInfo)
return match == null ? undefined : {
  streamUrl: match.track.streamUrl,
  pictureUrl: match.track.pictureUrl,
  lyricsUrl: match.track.lyricsUrl,
}
```

Keep private-network relaxation test-only exactly as today.

- [ ] **Step 4: Replace the download single-active lookup**

Resolve internal download candidates/resources through the bundle resolver and remove `sources.list().find(item => item.active)` from download wiring.

- [ ] **Step 5: Update operator documentation**

Document order, request scope, local precedence, complete/mixed selection, four-second budget, no byte splicing, download restart-from-zero, and safe diagnostics.

- [ ] **Step 6: Verify Task 9**

```bash
npx vitest run src/server/sources/source.test.ts src/server/sources/fallback.test.ts src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.test.ts src/server/playback/bundleResolver.test.ts src/server/playback/proxy.test.ts src/server/routes/catalog.test.ts src/server/downloads/downloads.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
npm run build:server
npx eslint src/server/app.ts src/server/routes/playback.ts src/server/routes/catalog.ts src/server/sources src/server/playback src/server/downloads src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
```

Expected: PASS, build succeeds, lint exits 0.

- [ ] **Step 7: Commit when authorized**

```bash
git add src/server/app.ts src/server/routes/playback.ts src/server/routes/catalog.ts src/server/api/openapi.test.ts docs/server-web.md
git commit -m "feat(service): enable multi-source playback bundles"
```

### Task 10: Freeze and Verify the Service Result

**Files:**
- Verify only: all files changed by Tasks 1–9.

**Interfaces:**
- Consumes: completed Service implementation.
- Produces: frozen evidence and the contract required by the Flutter plan.

- [ ] **Step 1: Inspect scope and secret boundaries**

```bash
git status --short
git diff --check
git diff --stat
git diff -- src/server/sources src/server/playback src/server/routes/sources.ts src/server/routes/playback.ts src/server/routes/catalog.ts src/server/downloads src/server/app.ts src/server/api docs/server-web.md
```

Expected: only intended changes plus identified pre-existing user work; no sensitive resolved data.

- [ ] **Step 2: Run the frozen focused suite once**

```bash
npx vitest run src/server/sources/source.test.ts src/server/sources/fallback.test.ts src/server/playback/mediaClient.test.ts src/server/playback/resourceStore.test.ts src/server/playback/bundleResolver.test.ts src/server/playback/proxy.test.ts src/server/routes/catalog.test.ts src/server/downloads/downloads.test.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts
```

Expected: zero failed tests.

- [ ] **Step 3: Run broad Service verification**

```bash
npm run test:unit
npm run build:server
npm run lint
```

Expected: exit 0. Preserve and classify any failure caused by unrelated pre-existing changes instead of altering unrelated files.

- [ ] **Step 4: Prove rollback compatibility**

In a temporary copied storage root, enable two sources and verify `web_source_state.active_source_id` equals priority zero. Start a previous Service build against a second copy and confirm it sees the primary source; never risk the user's real storage root.

- [ ] **Step 5: Commit verification-only corrections when authorized**

```bash
git add src/server/sources src/server/playback src/server/routes/sources.ts src/server/routes/playback.ts src/server/routes/catalog.ts src/server/downloads src/server/app.ts src/server/api/openapi.test.ts src/web-runtime/runtime.test.ts docs/server-web.md
git commit -m "test(service): verify multi-source fallback"
```

Do not create an empty commit when no correction was needed.

---

## Flutter Handoff Contract

Flutter implementation starts only after Task 9 freezes these contracts:

- `GET /api/v1/sources` includes required `active`, `enabled`, and nullable `priority`.
- `PUT /api/v1/sources/enabled` accepts `{ "sourceIds": string[] }` and returns the complete list.
- `PUT /api/v1/sources/active` promotes without clearing enabled backups.
- Playback resolve retains `url`, `quality`, and `expiresAt`, and may add `resources` plus `completeness`.
- `resources.lyrics` and `resources.lyricsUrl` are mutually exclusive; `pictureUrl` is same-origin.
- `SOURCE_ALL_UNAVAILABLE.details.attempts` contains only safe ID/action/code/duration fields.
- `sources.updated` publishes the complete public source list.
