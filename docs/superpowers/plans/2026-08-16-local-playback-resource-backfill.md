# Local Playback Resource Backfill Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep cached local audio playback immediate while asynchronously resolving, displaying, and safely writing back missing lyrics and artwork for Service-managed downloads.

**Architecture:** Flutter continues to play a complete local audio cache without waiting, then reuses `PlaybackRepository.resolve` as a resource-refresh request when the current track lacks artwork or a lyrics resource. Manual local-lyrics retry calls the existing catalog lyrics endpoint instead of returning an empty value. Service remains the authority for local reads, cross-provider matching, validation, caching, atomic metadata enrichment, and library update events.

**Tech Stack:** Flutter/Dart, player controller, Fastify/TypeScript, Vitest, Flutter test, `PlaybackBundleResolver`, `TrackResourceService`, `TrackResourceCoordinator`, and `LibraryMetadataEnricher`.

## Global Constraints

- Audio playback must not wait for online metadata lookup and must never switch away from selected local audio.
- Automatic writes are limited to files under the Service-managed audio root.
- Existing lyrics, LRC files, and artwork are never overwritten.
- Candidate matching requires normalized title agreement, uses artist to reject ambiguity, and limits known-duration differences to five seconds.
- Lyrics and artwork may come from different providers; at most six deduplicated alternatives are evaluated.
- Resource failures are non-fatal to playback; caller cancellation and safety failures remain terminal for the resource request.
- Successful writes use the existing staged-file verification and atomic publication path.
- Do not restore deleted download history, require an original provider ID, add dependencies, or alter the audio-cache format.

---

### Task 1: Refresh Missing Resources After Cached Flutter Playback

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/player_controller.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_controller_test.dart`

**Interfaces:**
- Consumes: `PlaybackResolver.resolve(Track track, String quality) -> Future<PlaybackSource>` and `PlaybackSource.bundleLyrics`, `lyricsUri`, and `pictureUri`.
- Produces: a private generation-safe background refresh invoked after `AudioHandler.playCachedTrack` succeeds when the current track lacks lyrics or artwork.

- [x] **Step 1: Write failing cached-playback refresh tests**

Add controller tests using a fake audio handler whose `playCachedTrack` returns `true` and a resolver that records calls:

```dart
test('cached local audio starts immediately and refreshes missing resources', () async {
  final audio = FakeAudioHandler(cached: true);
  final resolver = RecordingResolver(
    bundleSource(
      lyrics: const Lyrics(original: '[00:01.00]online'),
      pictureUri: validPictureUri,
    ),
  );
  final controller = player(audio: audio, resolver: resolver);

  await controller.play(localTrackWithoutResources);
  await pumpEventQueue();

  expect(audio.cachedPlayCalls, 1);
  expect(resolver.calls, [localTrackWithoutResources]);
  expect(controller.state.lyrics?.original, '[00:01.00]online');
  expect(controller.state.current?.picture, contains('/picture'));
});
```

Add cases proving that a complete cached track performs no refresh, refresh failure does not set `PlayerProcessing.error`, and a late result is ignored after switching tracks.

- [x] **Step 2: Run the focused test and confirm the new cases fail**

Run:

```bash
flutter test test/features/player/player_controller_test.dart
```

Expected: the missing-resource case fails because `_playCurrent` returns immediately after cached audio starts.

- [x] **Step 3: Implement the generation-safe background refresh**

Add a private method following this contract:

```dart
Future<void> _refreshCachedResources(Track track, int generation) async {
  if (_hasLyricsResource(track) && _hasArtwork(track)) return;
  try {
    final source = await resolver.resolve(track, state.quality);
    if (!_isCurrent(generation, track)) return;
    _applyResolvedResources(source, generation: generation);
  } on Object {
    // Optional metadata refresh must not alter cached audio playback.
  }
}
```

Invoke it with `unawaited(...)` immediately after cached playback succeeds. Extract the resource-only portion of `_applyResolvedBundle` into `_applyResolvedResources`; it may update the queue entry, bundle lyrics, lyrics URL, artwork URL, completeness, and request generations, but must not call `audio.playTrack` or replace the audio session. Use `_playGeneration` and `_isCurrent` for stale-result rejection.

- [x] **Step 4: Run the controller tests and confirm they pass**

Run the same focused Flutter test. Expected: cached audio remains immediate; resource success, failure, complete-track skip, and stale-result cases all pass.

---

### Task 2: Route Local Lyrics Retry Through Service

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_repository.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/repositories_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_screen_test.dart`

**Interfaces:**
- Consumes: `POST /api/v1/catalog/tracks/lyrics` with `{ source, musicInfo }` and `Track.toServiceMusicInfoJson()`.
- Produces: `SearchRepository.lyrics(Track)` requests Service for a local track when no safe library `lyricsUrl` exists.

- [x] **Step 1: Write a failing local-lyrics repository test**

```dart
test('local lyrics without a resource URL fall back to Service lookup', () async {
  final api = RecordingServiceApi(response: {'lyric': '[00:01.00]resolved'});
  final repository = SearchRepository(api);

  final lyrics = await repository.lyrics(localTrackWithoutLyricsUrl);

  expect(lyrics.original, '[00:01.00]resolved');
  expect(api.lastPath, '/api/v1/catalog/tracks/lyrics');
  expect(api.lastBody, {
    'source': 'local',
    'musicInfo': localTrackWithoutLyricsUrl.toServiceMusicInfoJson(),
  });
});
```

Retain the same-origin `lyricsUrl` GET test. Add a player test proving a Service failure reaches `PlayerState.lyricsError`, leaving the existing retry control active.

- [x] **Step 2: Run the repository and player tests and confirm failure**

Run:

```bash
flutter test test/features/repositories_test.dart test/features/player/player_screen_test.dart
```

Expected: the repository test fails because local tracks currently return `Lyrics(original: '')`.

- [x] **Step 3: Remove the local empty-lyrics shortcut**

Keep the safe resource GET first, then use the existing POST branch for every source:

```dart
if (resourcePath != null) {
  return Lyrics.fromJson(await api.request('GET', resourcePath));
}
return Lyrics.fromJson(
  await api.request(
    'POST',
    '/api/v1/catalog/tracks/lyrics',
    body: {
      'source': track.source,
      'musicInfo': track.toServiceMusicInfoJson(),
    },
  ),
);
```

Do not add client-side provider search.

- [x] **Step 4: Run focused Flutter tests and confirm they pass**

Run the repository and player tests above. Expected: local retry reaches Service, existing local URLs still use GET, and retry UI behavior remains intact.

---

### Task 3: Prove Service Backfill and Managed-File Boundaries

**Files:**
- Modify only if tests expose a gap: `/Volumes/ext/lx-music-server-web/src/server/resources/trackResources.ts`
- Modify only if tests expose a gap: `/Volumes/ext/lx-music-server-web/src/server/resources/trackResourceCoordinator.ts`
- Test: `/Volumes/ext/lx-music-server-web/src/server/resources/trackResources.test.ts`
- Test: `/Volumes/ext/lx-music-server-web/src/server/resources/trackResourceCoordinator.test.ts`
- Test: `/Volumes/ext/lx-music-server-web/src/server/playback/bundleResolver.test.ts`
- Test: `/Volumes/ext/lx-music-server-web/src/server/app.test.ts`

**Interfaces:**
- Consumes: `TrackResourceService.resolveLyrics('local', musicInfo, signal)`, `PlaybackBundleResolver.resolve({ source: 'local', info, quality, preferLocal: true })`, and `TrackResourceCoordinator.accept(event)`.
- Produces: verified local fallback and atomic write-back without depending on retained download history.

- [x] **Step 1: Add exact local-library regression tests**

```ts
it('searches alternative providers when a local track has no lyrics', async() => {
  const lyrics = await service.resolveLyrics('local', localTrack)
  expect(findAlternatives).toHaveBeenCalledWith(expect.objectContaining({ source: 'local' }))
  expect(lyrics.lyric).toContain('[00:01.00]')
})
```

```ts
it('keeps local audio and supplies alternative artwork without musicUrl', async() => {
  const bundle = await resolver.resolve({ source: 'local', info: localTrack, quality: 'flac', preferLocal: true })
  expect(bundle.audioKind).toBe('local')
  expect(bundle.resources.pictureUrl).toMatch(/\/picture$/)
  expect(requestSource).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'musicUrl' }),
    expect.anything(),
  )
})
```

Extend coordinator coverage with a real temporary audio file under its managed root: publish a missing picture, wait for idle, verify exactly one picture is added, existing lyrics remain unchanged, and a duplicate event causes no second metadata change.

- [x] **Step 2: Run focused Service tests before changing production code**

```bash
npx vitest run \
  src/server/resources/trackResources.test.ts \
  src/server/resources/trackResourceCoordinator.test.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/app.test.ts
```

Expected: existing cross-provider and enrichment code should satisfy most cases. Any failure must identify a concrete gap before production code changes.

- [x] **Step 3: Make only evidence-required Service changes**

If identical manual requests duplicate searches, add separate in-flight maps in `TrackResourceService`, keyed by `trackResourceIdentity(source, normalized)`:

```ts
private readonly pendingLyrics = new Map<string, Promise<PlaybackLyrics>>()
private readonly pendingPictures = new Map<string, Promise<ValidatedPicture>>()
```

Return an existing promise and remove it in `finally`. Do not share a caller-owned abort signal across subscribers: cancellation stops only that subscriber's wait, while the bounded underlying lookup may complete and populate cache. If managed-root or publication tests fail, fix only the demonstrated boundary through `LibraryMetadataEnricher` and `DownloadManager.publishMetadataPatch`; do not add another metadata writer.

- [x] **Step 4: Run focused Service tests and static checks**

```bash
npx vitest run \
  src/server/resources/trackResources.test.ts \
  src/server/resources/trackResourceCoordinator.test.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/app.test.ts
npx eslint \
  src/server/resources/trackResources.ts \
  src/server/resources/trackResources.test.ts \
  src/server/resources/trackResourceCoordinator.ts \
  src/server/resources/trackResourceCoordinator.test.ts \
  src/server/playback/bundleResolver.test.ts \
  src/server/app.test.ts
git diff --check
```

Expected: focused tests, ESLint, and whitespace validation pass.

---

### Task 4: Cross-Project Acceptance

**Files:**
- Verify: `/Volumes/ext/MusicFree/flutter-client`
- Verify: `/Volumes/ext/lx-music-server-web`

**Interfaces:**
- Consumes: Flutter cached-playback refresh and existing Service resource/write-back APIs.
- Produces: cross-project evidence without mutating the active Docker deployment.

- [x] **Step 1: Run relevant Flutter suites**

```bash
flutter test \
  test/features/player/player_controller_test.dart \
  test/features/player/player_screen_test.dart \
  test/features/repositories_test.dart \
  test/events/event_coordinator_test.dart
flutter analyze
```

Expected: tests and analysis pass.

- [x] **Step 2: Run complete Service verification**

```bash
npx vitest run
npm run prepare:service
npm run verify:service-runtime
npm run verify:service-isolated
git diff --check
```

Expected: tests, build, native runtime, isolated package, and diff checks pass. Existing unrelated dependency warnings may remain.

- [ ] **Step 3: Exercise 《九九八十一》 without production data**

Use a temporary Service storage root containing a copied fixture or generated tagged audio named `九九八十一 - 双笙 (陈元汐)、易言、樊棋、南久.flac`. Verify:

```text
playback resolve status = 200
audioKind = local
stream source = local
lyrics present = true
picture present = true
alternative musicUrl requests = 0
managed file picture count after coordinator idle = 1
existing lyrics unchanged = true
```

Do not use the active Docker volume.

- [ ] **Step 4: Review final scoped diffs and report deployment state**

Run `git status --short` and scoped `git diff --stat` in both repositories. Preserve unrelated changes, do not commit without authorization, and report that Docker remains unchanged unless separately authorized.
