# Cross-Provider Resource Backfill Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the selected audio unchanged while filling missing lyrics and artwork from matching tracks on alternative built-in providers after the original provider chain is exhausted.

**Architecture:** `TrackResourceService` receives the existing alternative-track finder and owns catalog/manual-retry cross-provider backfill. `PlaybackBundleResolver` reuses its existing alternative finder for optional enrichment after original-provider audio selection, evaluating only missing lyrics/artwork so audio cannot change. Both paths retain source-script priority, built-in fallback, validation, cancellation, caching, and safe exhaustion behavior.

**Tech Stack:** TypeScript, Fastify Service, Vitest, existing TuneFlow music SDK provider matching.

## Global Constraints

- Preserve local resource and cache priority.
- Preserve the selected audio URL and provider during optional-resource backfill.
- Search the original provider through enabled A/B/C scripts and its built-in implementation before alternative providers.
- Resolve lyrics and artwork independently.
- Reuse existing title, singer, album, and duration matching from `findAlternativeMusic`.
- Skip same-provider and duplicate alternatives and inspect at most six alternatives per resource request.
- Caller cancellation and safety failures remain terminal.
- Public API schemas remain backward compatible and expose no provider URLs, headers, scripts, lyric text in diagnostics, or image bytes.

---

### Task 1: Catalog and Manual-Retry Cross-Provider Backfill

**Files:**
- Modify: `src/server/resources/trackResources.ts`
- Modify: `src/server/resources/trackResources.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: existing `findAlternativeMusic(musicInfo): Promise<Array<Record<string, unknown>>>`, source snapshots, built-in lyric/picture callbacks, cache, local resources.
- Produces: `TrackResourceServiceOptions.findAlternatives?: (musicInfo: unknown) => Promise<Array<Record<string, unknown>>>` and bounded cross-provider fallback in `resolveLyrics` and `resolvePicture`.

- [ ] **Step 1: Write failing lyrics-order tests**

Add tests that inject alternatives for `kg -> wy -> tx`, record source-script and built-in calls, and assert:

```ts
expect(calls).toEqual([
  'script:kg', 'builtin:kg',
  'script:wy', 'builtin:wy',
])
expect(result).toEqual({ lyric: '[00:01.00]alternative' })
```

Also assert that an original-provider success never calls `findAlternatives`, and that the cached result is returned on the second request without another search.

- [ ] **Step 2: Run the lyrics tests and verify the new cases fail**

Run:

```bash
npx vitest run src/server/resources/trackResources.test.ts -t "alternative provider lyrics|does not search alternatives|caches alternative lyrics"
```

Expected: FAIL because `TrackResourceServiceOptions` does not accept or call `findAlternatives`.

- [ ] **Step 3: Implement bounded candidate normalization and lyrics fallback**

In `trackResources.ts`, add:

```ts
export const MAX_RESOURCE_ALTERNATIVES = 6
```

Add a private candidate builder that calls `findAlternatives(normalized)`, skips candidates without a non-empty string `source`, skips the original provider, deduplicates by provider plus canonical track identity, preserves finder order, and slices to six candidates.

Extract one-candidate lyrics resolution so each candidate executes:

```text
enabled source snapshots for candidate provider -> built-in candidate provider
```

Use the original normalized track first, then alternative candidates. Cache a validated success under the original request identity.

- [ ] **Step 4: Run the lyrics tests and verify they pass**

Run:

```bash
npx vitest run src/server/resources/trackResources.test.ts -t "alternative provider lyrics|does not search alternatives|caches alternative lyrics"
```

Expected: PASS.

- [ ] **Step 5: Write failing artwork, bounds, and terminal tests**

Add cases proving:

```ts
expect(findAlternatives).toHaveBeenCalledTimes(1)
expect(requestedProviders).toEqual(['kg', 'wy'])
expect(fetchArtwork).toHaveBeenCalledWith(
  { url: 'https://alternative.test/cover.jpg' },
  expect.anything(),
)
```

Add alternatives containing a same-provider entry, a duplicate identity, and more than six unique candidates; assert only the first six eligible candidates run. Add cancellation and `origin: 'safety'` cases and assert they reject without searching the next provider.

- [ ] **Step 6: Run the new artwork/boundary tests and verify they fail**

Run:

```bash
npx vitest run src/server/resources/trackResources.test.ts -t "alternative provider picture|bounds alternatives|alternative cancellation|alternative safety"
```

Expected: FAIL because picture fallback and candidate bounds are not implemented.

- [ ] **Step 7: Apply the same candidate chain to artwork and wire the finder**

Resolve each picture candidate through its enabled scripts, built-in provider, and canonical snapshot URL, validating bytes through `MediaClient`. Preserve local/cache priority and cache the first valid picture under the original identity. In `app.ts`, construct `TrackResourceService` with:

```ts
findAlternatives: findAlternativeMusic,
```

- [ ] **Step 8: Run all resource and catalog tests**

Run:

```bash
npx vitest run src/server/resources/trackResources.test.ts src/server/routes/catalog.test.ts src/server/sources/musicInfo.test.ts
```

Expected: PASS.

### Task 2: Playback Optional-Resource Backfill Without Audio Replacement

**Files:**
- Modify: `src/server/playback/bundleResolver.ts`
- Modify: `src/server/playback/bundleResolver.test.ts`

**Interfaces:**
- Consumes: `PlaybackBundleResolverOptions.findAlternatives`, `evaluateTrack(..., includeAudio = false, wantedResources)`, built-in resource callbacks.
- Produces: alternative-provider enrichment for an already selected original-provider audio bundle; `sourceIds.audio` and stream candidates remain unchanged.

- [ ] **Step 1: Write failing playback lyrics and artwork tests**

Create an original `kg` evaluation with usable audio but no lyrics/artwork and one matching `wy` alternative. Assert:

```ts
expect(bundle.sourceIds).toEqual({
  audio: 'original-audio-script',
  lyrics: 'alternative-resource-script',
  picture: 'alternative-resource-script',
})
expect(bundle.streamCandidates.map(value => value.sourceId))
  .toEqual(['original-audio-script'])
expect(requests.filter(value => value.provider === 'wy').map(value => value.action))
  .toEqual(['lyric', 'pic'])
```

- [ ] **Step 2: Run the playback tests and verify they fail**

Run:

```bash
npx vitest run src/server/playback/bundleResolver.test.ts -t "backfills resources from an alternative provider|does not replace original audio"
```

Expected: FAIL because alternatives are searched only when original audio is absent.

- [ ] **Step 3: Implement missing-only alternative enrichment**

After original-provider evaluation selects usable audio, determine missing lyric/picture actions. If any remain, call the existing alternative finder and process the same bounded, deduplicated alternative order with `includeAudio = false`. Stop once all wanted resources are filled or the enrichment deadline expires. Merge only resource fields into the original evaluated set/result; do not append alternative audio candidates.

For each alternative candidate, preserve its own provider when calling source scripts and built-in callbacks. Treat optional-resource failure as continuation unless caller cancellation or safety policy requires termination.

- [ ] **Step 4: Run playback resolver tests**

Run:

```bash
npx vitest run src/server/playback/bundleResolver.test.ts
```

Expected: PASS, including original-track-before-alternatives audio behavior.

### Task 3: Service Integration Verification

**Files:**
- Modify only if a test exposes a defect: `src/server/app.test.ts`, `src/server/api/openapi.test.ts`
- Verify: `src/server/resources/trackResources.ts`, `src/server/playback/bundleResolver.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: completed catalog and playback resource fallback.
- Produces: buildable Service with unchanged public API contracts.

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
npx vitest run \
  src/server/resources/trackResources.test.ts \
  src/server/routes/catalog.test.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/app.test.ts \
  src/server/api/openapi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint on changed implementation and tests**

Run:

```bash
npx eslint \
  src/server/resources/trackResources.ts \
  src/server/resources/trackResources.test.ts \
  src/server/playback/bundleResolver.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/app.ts
```

Expected: PASS with no errors.

- [ ] **Step 3: Build the Service package**

Run:

```bash
npm run prepare:service
npm run verify:service-runtime
npm run verify:service-isolated
```

Expected: all commands exit zero.

- [ ] **Step 4: Exercise the exact song against a temporary local Service**

Start the built Service with an isolated temporary storage root and the same
non-secret source configuration fixtures used by integration tests. Search for
`壁上观 / 邓寓君(等什么君)`, resolve playback, then request catalog lyrics.
Assert the lyric response is HTTP 200 with a non-empty timed lyric and that the
resolved playback URL/resource token remains the original audio selection.

- [ ] **Step 5: Review the final diff and repository status**

Confirm only the scoped Service implementation, tests, spec, and plan changed
for this feature. Preserve all pre-existing dirty worktree changes and do not
commit, deploy, restart containers, or mutate persistent media unless separately
authorized.
