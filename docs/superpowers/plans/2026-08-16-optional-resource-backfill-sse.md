# Optional Resource Backfill and SSE Refresh Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lyrics and artwork fall through independent source candidates, safely fill missing local-file metadata, and refresh missing current lyrics through the existing SSE connection without changing playback audio.

**Architecture:** A Service-owned track-resource service performs local/cache/source/built-in resolution and emits validated availability to a coordinator. The coordinator attaches resources to active downloads and stages fill-missing metadata updates with DownloadManager crash recovery. Flutter consumes `track.resources.updated` as an invalidation and invokes its existing lyrics API only for the matching current track.

**Tech Stack:** TypeScript 5.9, Fastify 5, Vitest 4, `music-metadata`, `taglib-wasm`, Node filesystem primitives, Dart/Flutter, Riverpod, `package:http`, Flutter test.

## Global Constraints

- Service owns fallback, validation, caching, matching, file writes, integrity, and SSE publication; Flutter never writes files.
- SSE contains only provider, track id, and resource kinds—never lyrics text, artwork bytes, URLs, headers, scripts, tokens, or paths.
- Optional resources try enabled custom sources by priority, then built-in; artwork may finally use canonical `meta.picUrl`.
- Caller cancellation, validation, and safety failures remain terminal. Network, timeout, script, protocol, empty, and invalid-resource failures are candidate-local.
- Do not weaken generic `runSourceFallback` semantics.
- Automatic enrichment only fills missing enabled fields and never replaces existing embedded artwork, embedded lyrics, or `.lrc`.
- Only user-confirmed `existingFilePolicy: replace` may replace an existing file and its metadata wholesale.
- Published-file mutation uses a sibling `.tuneflowtmp`, verification, persisted managed-file recovery marker, fsync, and atomic rename.
- Cache bounds: 5-minute TTL, 256 track entries, 32 MiB copied payloads. Lyrics: 1 MiB per field and 2 MiB total.
- Preserve both dirty worktrees. Do not commit, push, deploy, or alter the LAN Service without separate authorization.

---

### Task 1: Service track-resource resolution and catalog integration

**Files:**
- Create: `src/server/resources/trackResources.ts`
- Create: `src/server/resources/trackResources.test.ts`
- Modify: `src/server/routes/catalog.ts`
- Modify: `src/server/routes/catalog.test.ts`
- Modify: `src/server/library/scanner.ts`
- Modify: `src/server/library/scanner.test.ts`
- Modify: `src/server/playback/bundleResolver.ts`
- Modify: `src/server/playback/bundleResolver.test.ts`

**Interfaces:**
- Consumes: `SourcesService.snapshot/requestSource`, `MediaClient.fetchArtwork`, built-in `getLyric/getPicture`, `canonicalPictureUrl`, `toSourceMusicInfo`, `LibraryResourceStore.ensure`, `PlaybackResourceStore`.
- Produces:

```ts
export interface TrackResourceIdentity { source: string, trackId: string }
export interface ValidatedPicture { bytes: Uint8Array, mimeType: string }
export interface ValidatedTrackResources {
  lyrics?: PlaybackLyrics
  picture?: ValidatedPicture
}
export interface TrackResourcesAvailable {
  identity: TrackResourceIdentity
  musicInfo: unknown
  resources: ValidatedTrackResources
}
export class TrackResourceCache {
  get(identity: TrackResourceIdentity): ValidatedTrackResources | undefined
  merge(identity: TrackResourceIdentity, resources: ValidatedTrackResources): ValidatedTrackResources
}
export class TrackResourceService {
  subscribe(listener: (event: TrackResourcesAvailable) => void): () => void
  remember(source: string, musicInfo: unknown, resources: ValidatedTrackResources): void
  resolveLyrics(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<PlaybackLyrics>
  resolvePicture(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<ValidatedPicture>
}
LibraryScanner.readMatchingResources(musicInfo: unknown): Promise<ValidatedTrackResources | undefined>
```

- [ ] **Step 1: Write failing resolver/cache tests**

Cover canonical identity, defensive copies, TTL/entry/byte eviction, malformed source A continuing to B, all custom failures reaching built-in, `U+FFFD` and size rejection, terminal caller/safety behavior, picture validation, local/cache preference, and one notification after cache insertion.

```ts
it('continues after source-local lyric protocol failure', async() => {
  const requestSource = vi.fn(async(id: string) => {
    if (id === 'a') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'bad', 'script')
    return { lyric: '[00:01.00]backup' }
  })
  const service = fixtureService({ candidates: ['a', 'b'], requestSource })
  await expect(service.resolveLyrics('tx', fixtureTrack)).resolves.toEqual({ lyric: '[00:01.00]backup' })
  expect(requestSource.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
})

it('keeps safety failure terminal', async() => {
  const requestSource = vi.fn(async() => {
    throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked', 'safety')
  })
  const service = fixtureService({
    candidates: ['a', 'b'],
    requestSource,
  })
  await expect(service.resolveLyrics('tx', fixtureTrack)).rejects.toMatchObject({ origin: 'safety' })
  expect(requestSource).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Write failing catalog and scanner tests**

Replace `does not cross a terminal source-script failure` with lyrics-specific continuation. Add custom-all-fail/built-in-success, cache-hit/no-upstream, and safety-terminal cases. Tag a copy of `src/renderer/assets/medias/Silence02s.mp3` and prove the scanner returns copied embedded resources without paths.

- [ ] **Step 3: Run tests and confirm red**

```bash
npx vitest run src/server/resources/trackResources.test.ts src/server/routes/catalog.test.ts src/server/library/scanner.test.ts
```

Expected: FAIL because new interfaces do not exist and catalog still uses generic fallback.

- [ ] **Step 4: Implement identity, validation, and bounded cache**

Normalize music info and choose `id`, then `songmid`, then `meta.songId`; throw a protocol error if absent.

```ts
export const trackResourceIdentity = (source: string, musicInfo: unknown): TrackResourceIdentity => {
  const info = normalizeMusicInfo(musicInfo) as Record<string, unknown>
  const meta = typeof info.meta === 'object' && info.meta != null ? info.meta as Record<string, unknown> : {}
  const raw = [info.id, info.songmid, meta.songId].find(value =>
    (typeof value === 'string' && value.trim() !== '') || typeof value === 'number')
  if (raw == null) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Track identity is missing', 'protocol')
  return { source, trackId: String(raw) }
}
```

Copy strings and picture bytes both entering and leaving cache. Notify only after a newly accepted value is cached; never notify on hits.

- [ ] **Step 5: Implement resource-specific fallback**

Sort snapshots by priority. Continue on source-local optional failures, retain only safe attempt codes, stop for caller/safety, then call built-in. Artwork fetches and validates bytes for each URL; canonical snapshot is last.

```ts
const terminal = (error: unknown): boolean =>
  error instanceof SourceServiceError && (error.origin === 'caller' || error.origin === 'safety')

for (const candidate of sources.snapshot(source, 'lyric')) {
  try {
    return rememberLyrics(validateLyrics(await sources.requestSource(candidate.id, request, signal)))
  } catch (error) {
    if (terminal(error)) throw error
    attempts.push(safeAttempt(candidate, error))
  }
}
return rememberLyrics(validateLyrics(await getBuiltinLyrics(source, normalized)))
```

- [ ] **Step 6: Delegate catalog routes and share bundle resources**

Add `trackResources?: TrackResourceService` to `CatalogResourceOptions`. Remove route-local replacement-character validation and lyric/picture `runSourceFallback`. Store validated picture bytes in `PlaybackResourceStore` and keep the existing opaque URL response.

Add this optional playback callback and invoke it only for validated resources, resolving picture tokens through `PlaybackResourceStore.getPicture`:

```ts
onResolvedResources?: (source: string, musicInfo: unknown, resources: ValidatedTrackResources) => void
```

Do not change audio selection, hedge timing, URLs, or headers.

- [ ] **Step 7: Run focused tests**

```bash
npx vitest run src/server/resources/trackResources.test.ts src/server/routes/catalog.test.ts src/server/library/scanner.test.ts src/server/playback/bundleResolver.test.ts src/server/sources/fallback.test.ts
```

Expected: PASS; generic script/protocol fallback remains terminal.

- [ ] **Step 8: Commit only if separately authorized**

```bash
git add src/server/resources/trackResources.ts src/server/resources/trackResources.test.ts src/server/routes/catalog.ts src/server/routes/catalog.test.ts src/server/library/scanner.ts src/server/library/scanner.test.ts src/server/playback/bundleResolver.ts src/server/playback/bundleResolver.test.ts
git commit -m "fix: resolve optional track resources across sources"
```

Without authorization, leave changes uncommitted.

### Task 2: Safe fill-missing metadata and managed-file recovery

**Files:**
- Create: `src/server/library/metadataEnricher.ts`
- Create: `src/server/library/metadataEnricher.test.ts`
- Modify: `src/server/downloads/taglibMetadata.ts`
- Modify: `src/server/downloads/taglibMetadata.test.ts`
- Modify: `src/server/library/resources.ts`
- Modify: `src/server/library/resources.test.ts`
- Modify: `src/server/downloads/types.ts`
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/downloads.test.ts`

**Interfaces:**
- Consumes: validated resources, settings, existing matching/integrity logic, `music-metadata`, `taglib-wasm`.
- Produces:

```ts
export interface MetadataPatchPublication {
  targetPath: string
  stagedPath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
}
export interface MetadataEnrichmentResult {
  changed: ReadonlyArray<'lyrics' | 'picture' | 'sidecar'>
  integrity?: DownloadFileIntegrity
}
export class LibraryMetadataEnricher {
  enrich(filePath: string, resources: ValidatedTrackResources, settings: TuneFlow.AppSetting): Promise<MetadataEnrichmentResult>
}
DownloadManager.attachResolvedResources(musicInfo: TuneFlow.Music.MusicInfoOnline, resources: ResolvedDownload['resources']): number
DownloadManager.publishMetadataPatch(input: MetadataPatchPublication): boolean
LibraryResourceStore.invalidate(audioFilePath: string): void

DownloadManagerOptions.onCompleted?: (
  filePath: string,
  job: Readonly<DownloadJobRecord>,
) => Promise<unknown> | unknown
```

- [ ] **Step 1: Write failing real-file merge tests**

Using copied `Silence02s.mp3`, prove missing lyrics/picture are added independently; existing values and the other field are preserved; existing `.lrc` is not replaced; disabled settings write nothing; parse/write/verification/precondition failures leave original bytes and no `.tuneflowtmp`.

```ts
it('adds missing lyrics without replacing artwork', async() => {
  await writeAudioMetadata(audio, { title: 'Fixture', picture: png, pictureMimeType: 'image/png' })
  const result = await enricher.enrich(audio, { lyrics: { lyric: '[00:01.00]new' } }, embedSettings)
  const parsed = await parseFile(audio)
  expect(result.changed).toEqual(['lyrics'])
  expect(parsed.common.picture?.[0].data).toEqual(png)
  expect(parsed.common.lyrics?.some(value => value.text === '[00:01.00]new')).toBe(true)
})
```

- [ ] **Step 2: Write failing download attachment and crash tests**

Cover late resource merge, selected-candidate precedence, completion callback arguments, managed metadata SHA update, restart before rename, restart after rename before DB update, and conflict refusal.

- [ ] **Step 3: Run tests and confirm red**

```bash
npx vitest run src/server/library/metadataEnricher.test.ts src/server/downloads/taglibMetadata.test.ts src/server/library/resources.test.ts src/server/downloads/downloads.test.ts -t "metadata|late resource|completion callback"
```

Expected: FAIL because helpers, publisher, and marker are absent.

- [ ] **Step 4: Implement missing-only TagLib mutation**

Add `addMissingAudioMetadata(filePath, patch)`. Parse before writing; set picture only if no supported non-empty picture and lyrics only if no nonblank embedded lyric. Parse after and verify new fields plus hashes/text for preexisting picture and lyrics.

- [ ] **Step 5: Implement staged enrichment and resource invalidation**

Validate a regular file under audio root, hash it, copy to a sibling `.tuneflowtmp`, preserve mode, apply enabled missing fields, create a sidecar only when enabled and absent, verify, and recheck original hash.

Inject this callback:

```ts
publish?: (input: MetadataPatchPublication) => Promise<boolean> | boolean
```

`true` means DownloadManager published; `false` means the enricher fsyncs and atomically renames. Clean stages on failure. `LibraryResourceStore.invalidate` removes only derived resources/marker, never audio or user sidecar.

- [ ] **Step 6: Implement late resource merge and managed crash marker**

Candidate resources win; late resources fill only missing lyrics/picture bytes/MIME. Change `onCompleted` to receive `(filePath, readonlyJob)`.

Persist on `DownloadJobRecord`:

```ts
metadataPatch?: {
  stagedRelativePath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
}
```

Before rename persist marker; after rename/fsync update size/SHA and clear. Recovery rules: accept final replacement; finish valid staged replacement over unchanged original; clear abandoned missing-stage marker; preserve both and report bounded error if neither hash matches. Add checkpoints after marker and rename.

- [ ] **Step 7: Run full metadata/download tests**

```bash
npx vitest run src/server/library/metadataEnricher.test.ts src/server/downloads/taglibMetadata.test.ts src/server/library/resources.test.ts src/server/downloads/downloads.test.ts
```

Expected: PASS, including existing replacement rollback.

- [ ] **Step 8: Commit only if separately authorized**

```bash
git add src/server/library/metadataEnricher.ts src/server/library/metadataEnricher.test.ts src/server/downloads/taglibMetadata.ts src/server/downloads/taglibMetadata.test.ts src/server/library/resources.ts src/server/library/resources.test.ts src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts
git commit -m "feat: safely backfill missing audio metadata"
```

Without authorization, leave changes uncommitted.

### Task 3: Service resource coordination and SSE publication

**Files:**
- Create: `src/server/resources/trackResourceCoordinator.ts`
- Create: `src/server/resources/trackResourceCoordinator.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `src/server/routes/events.test.ts`

**Interfaces:**
- Consumes: Task 1 service/subscription, Task 2 DownloadManager/enricher/invalidation, `ServiceEvents.publish`.
- Produces:

```ts
export class TrackResourceCoordinator {
  accept(event: TrackResourcesAvailable): void
  onDownloadCompleted(filePath: string, job: Readonly<DownloadJobRecord>): Promise<void>
  waitForIdle(): Promise<void>
  close(): void
}
```

- [ ] **Step 1: Write failing coordinator tests**

Prove cache availability precedes event; payload is only source/id/kinds; active job attachment; per-file serialization; duplicate coalescing; no mutation for present metadata; integrity/resource refresh after change; enrichment failure does not retract cached lyrics or expose paths.

```ts
expect(events.publish).toHaveBeenCalledWith('track.resources.updated', {
  source: 'tx', trackId: 'track-1', resources: ['lyrics'],
})
expect(JSON.stringify(events.publish.mock.calls)).not.toContain('/Volumes/')
```

- [ ] **Step 2: Run test and confirm red**

Run: `npx vitest run src/server/resources/trackResourceCoordinator.test.ts`

Expected: FAIL because coordinator does not exist.

- [ ] **Step 3: Implement nonblocking coordination**

On accept, adapt `{ lyrics, picture }` to `{ lyrics, pictureBytes: picture.bytes, pictureMimeType: picture.mimeType }`, attach it, and publish immediately because cache is readable. Queue backfill separately. Serialize by canonical path and merge pending fields. After change, use managed publisher when applicable, invalidate/ensure derived resources, refresh scanner, and publish `library.updated`. Log bounded codes only.

- [ ] **Step 4: Wire one service and coordinator in `createServer`**

Inject sources, built-ins, local reader, media client, and logger into one `TrackResourceService`. Subscribe coordinator. Point playback bundle callback and download bundle `resourcesFor` output to `remember`. Point DownloadManager completion to coordinator. Close/unsubscribe on server shutdown.

- [ ] **Step 5: Add an isolated app integration test**

With temp storage and fixture sources, make lyrics available after initial player state lacks them. Assert safe SSE event, cache/local catalog reread without second upstream call, local lyrics route after publication, and matching integrity.

- [ ] **Step 6: Run Service integration tests**

```bash
npx vitest run src/server/resources/trackResourceCoordinator.test.ts src/server/app.test.ts src/server/routes/events.test.ts src/server/downloads/downloads.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit only if separately authorized**

```bash
git add src/server/resources/trackResourceCoordinator.ts src/server/resources/trackResourceCoordinator.test.ts src/server/app.ts src/server/app.test.ts src/server/routes/events.test.ts
git commit -m "feat: publish track resource availability"
```

Without authorization, leave changes uncommitted.

### Task 4: Flutter SSE connection and typed invalidation

**Files (Flutter `/Volumes/ext/MusicFree/flutter-client`):**
- Modify: `lib/api/sse_transport.dart`
- Modify: `lib/events/event_coordinator.dart`
- Modify: `test/api/sse_transport_test.dart`
- Modify: `test/events/event_coordinator_test.dart`

**Interfaces:**

```dart
typedef SseConnected = void Function();
typedef TrackResourcesUpdated = void Function(String source, String trackId, Set<String> resources);

SseTransport(ServiceApi api, {
  http.Client? client,
  ReconnectDelay? delay,
  SseConnected? onConnected,
})
```

- [ ] **Step 1: Write failing connection and event tests**

Assert `onConnected` after each 200 connection, never non-200/after close. Assert valid resource event callback, malformed payload ignored without throwing, copied resource set, and unchanged existing invalidations.

```dart
coordinator.accept(const DomainEvent(
  type: 'track.resources.updated',
  data: <String, Object?>{
    'source': 'tx', 'trackId': 'track-1', 'resources': <String>['lyrics'],
  },
  sequence: 1,
));
expect(updates.single.resources, <String>{'lyrics'});
```

- [ ] **Step 2: Run tests and confirm red**

Run: `flutter test test/api/sse_transport_test.dart test/events/event_coordinator_test.dart`

Expected: FAIL because callbacks are absent.

- [ ] **Step 3: Implement callbacks**

Invoke `onConnected` after HTTP 200 and before reading chunks. Validate map/source/id/list/string entries before typed callback. Advance sequence once for all accepted events, even malformed resource payloads.

- [ ] **Step 4: Format and verify**

```bash
dart format lib/api/sse_transport.dart lib/events/event_coordinator.dart test/api/sse_transport_test.dart test/events/event_coordinator_test.dart
flutter test test/api/sse_transport_test.dart test/events/event_coordinator_test.dart
```

Expected: PASS.

- [ ] **Step 5: Commit only if separately authorized**

```bash
git add lib/api/sse_transport.dart lib/events/event_coordinator.dart test/api/sse_transport_test.dart test/events/event_coordinator_test.dart
git commit -m "feat: receive track resource events"
```

Without authorization, leave changes uncommitted.

### Task 5: Flutter current-track refresh and provider wiring

**Files (Flutter `/Volumes/ext/MusicFree/flutter-client`):**
- Modify: `lib/features/player/player_controller.dart`
- Modify: `lib/app/runtime_providers.dart`
- Modify: `test/features/player/player_controller_test.dart`
- Modify: `test/app/app_shell_test.dart`

**Interfaces:**
- Consumes: Task 4 callbacks, `SearchRepository.lyrics`, existing generation guards.
- Produces:

```dart
Future<void> PlayerController.refreshLyricsIfMissing(
  Future<Lyrics> Function(Track track) loader, {
  String? source,
  String? trackId,
})
```

- [ ] **Step 1: Write failing controller/provider tests**

Cover matching empty/error refresh, mismatched identity no-op, valid lyrics no-op, repeated calls sharing one future, track change discarding late result, matching event causing Service request, unrelated event no request, reconnect revalidation only when missing.

- [ ] **Step 2: Run tests and confirm red**

Run: `flutter test test/features/player/player_controller_test.dart test/app/app_shell_test.dart`

Expected: FAIL because refresh and wiring are absent.

- [ ] **Step 3: Implement coalesced conditional refresh**

```dart
Future<void> refreshLyricsIfMissing(
  Future<Lyrics> Function(Track) loader, {
  String? source,
  String? trackId,
}) {
  final track = state.current;
  if (track == null ||
      (source != null && track.source != source) ||
      (trackId != null && track.id != trackId) ||
      state.lyrics?.original.trim().isNotEmpty == true) {
    return Future<void>.value();
  }
  final existing = _missingLyricsRefresh;
  if (existing != null) return existing;
  late final Future<void> operation;
  operation = loadLyrics(loader).whenComplete(() {
    if (identical(_missingLyricsRefresh, operation)) _missingLyricsRefresh = null;
  });
  return _missingLyricsRefresh = operation;
}
```

- [ ] **Step 4: Wire event and reconnect callbacks**

Construct one `SearchRepository(connected.api).lyrics`. On matching event containing `lyrics`, call refresh with source/id via `unawaited`. Pass `onConnected` to `SseTransport` and refresh without identity. Coalescing prevents duplication with player-screen initialization.

- [ ] **Step 5: Format and verify**

```bash
dart format lib/features/player/player_controller.dart lib/app/runtime_providers.dart test/features/player/player_controller_test.dart test/app/app_shell_test.dart
flutter test test/features/player/player_controller_test.dart test/app/app_shell_test.dart test/api/sse_transport_test.dart test/events/event_coordinator_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit only if separately authorized**

```bash
git add lib/features/player/player_controller.dart lib/app/runtime_providers.dart test/features/player/player_controller_test.dart test/app/app_shell_test.dart
git commit -m "feat: refresh late lyrics from SSE"
```

Without authorization, leave changes uncommitted.

### Task 6: Final contract verification

**Files:**
- Modify only if a failure identifies a defect in files already listed.

**Interfaces:**
- Consumes: complete Service/Flutter contract.
- Produces: frozen evidence for fallback, file safety, SSE, build, and scope.

- [ ] **Step 1: Run focused Service suite**

```bash
npx vitest run \
  src/server/resources/trackResources.test.ts \
  src/server/resources/trackResourceCoordinator.test.ts \
  src/server/routes/catalog.test.ts \
  src/server/sources/fallback.test.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/library/metadataEnricher.test.ts \
  src/server/library/resources.test.ts \
  src/server/downloads/taglibMetadata.test.ts \
  src/server/downloads/downloads.test.ts \
  src/server/routes/events.test.ts \
  src/server/app.test.ts
```

Expected: PASS.

- [ ] **Step 2: Lint and build Service boundary**

```bash
npx eslint src/server/resources/trackResources.ts src/server/resources/trackResourceCoordinator.ts src/server/routes/catalog.ts src/server/library/metadataEnricher.ts src/server/library/scanner.ts src/server/library/resources.ts src/server/downloads/taglibMetadata.ts src/server/downloads/manager.ts src/server/downloads/types.ts src/server/app.ts
npm run build:server
```

Expected: PASS.

- [ ] **Step 3: Test and analyze Flutter boundary**

```bash
flutter test test/api/sse_transport_test.dart test/events/event_coordinator_test.dart test/features/player/player_controller_test.dart test/features/downloads/user_download_coordinator_test.dart test/features/downloads/redownload_confirmation_test.dart test/app/app_shell_test.dart
flutter analyze lib/api/sse_transport.dart lib/events/event_coordinator.dart lib/features/player/player_controller.dart lib/app/runtime_providers.dart
```

Expected: PASS with no changed-file analysis issues.

- [ ] **Step 4: Run scope checks in each repository**

```bash
git diff --check
git status --short
```

Inspect for secrets, runtime paths, source scripts, unrelated formatting, or lost user changes.

- [ ] **Step 5: Perform isolated local smoke verification**

Use temporary Service storage and fixture sources, never `192.168.0.172:3124`. Verify fallback, safe SSE payload, automatic current-player reload, missing-only MP3 lyrics, idempotent preservation, and confirmed `replace` behavior.

- [ ] **Step 6: Invoke verification-before-completion**

Report exact passing commands, changed files, both repository statuses, no deployment, and residual risk. Do not claim the running Mac client is fixed without authorized deployment/runtime verification.

- [ ] **Step 7: Commit only if separately authorized**

If authorized, commit Service and Flutter repositories separately. Otherwise leave both uncommitted.

### Task 7: Proactively resolve resources for asynchronous downloads

**Files:**
- Modify: `src/server/resources/trackResourceCoordinator.ts`
- Modify: `src/server/resources/trackResourceCoordinator.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `TrackResourceService.resolveLyrics/resolvePicture`, the download
  job cancellation signal, and the resources already returned by
  `PlaybackBundleResolver`.
- Produces:

```ts
TrackResourceCoordinator.resolveMissingForDownload(
  source: string,
  musicInfo: TuneFlow.Music.MusicInfoOnline,
  missing: ReadonlySet<'lyrics' | 'picture'>,
  signal?: AbortSignal,
): void
```

- [x] **Step 1: Write a failing coordinator test**

Prove that both missing resources begin without blocking the caller, each
resolver receives the download cancellation signal, one failure does not
cancel the other resource, and `waitForIdle()` observes completion.

- [x] **Step 2: Run the coordinator test and confirm red**

```bash
npx vitest run src/server/resources/trackResourceCoordinator.test.ts -t "resolves missing download resources"
```

Expected: FAIL because `resolveMissingForDownload` does not exist.

- [x] **Step 3: Implement tracked independent resolution**

Inject `resolveLyrics` and `resolvePicture` through the coordinator options.
Start only requested resource kinds, track each promise with the existing
pending-operation set, isolate failures through the bounded `onError` callback,
and rely on `TrackResourceService.remember` plus the existing subscription to
attach or backfill successful resources.

- [x] **Step 4: Write a failing app integration test**

Return an audio-only bundle while the custom resource resolver completes
later. Prove audio transfer starts without waiting, then prove the completed
local file gains the missing metadata and the library update is published
without a catalog lookup or manual retry.

- [x] **Step 5: Wire download resolution and verify green**

After `bundleResolver.resolve`, compute missing kinds from `bundle.resources`
and invoke `resolveMissingForDownload` without awaiting it. Pass the download
job signal. Keep `BUNDLE_ENRICHMENT_BUDGET_MS = 4_000` unchanged for playback.

```bash
npx vitest run src/server/resources/trackResourceCoordinator.test.ts src/server/app.test.ts src/server/downloads/downloads.test.ts src/server/playback/bundleResolver.test.ts
```

Expected: PASS, including playback budget and download cancellation
regressions.

- [x] **Step 6: Run lint and the isolated Service build**

```bash
npx eslint src/server/resources/trackResourceCoordinator.ts src/server/resources/trackResourceCoordinator.test.ts src/server/app.ts src/server/app.test.ts
npm run build:server
```

Expected: PASS.

- [x] **Step 7: Commit only if separately authorized**

Leave the supplement and implementation uncommitted unless the user separately
authorizes a commit.
