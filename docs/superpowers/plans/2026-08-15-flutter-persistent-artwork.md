# Flutter Persistent Service Artwork Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Service-local picture and lyrics URLs into every Flutter track consumer and keep CE-managed artwork files across normal app restarts.

**Architecture:** `LibraryRepository` is the same-origin contract boundary: it resolves Service-relative resource paths before constructing `Track`, so list, queue, player, and artwork widgets share one absolute image URL while local lyrics retain a validated Service path. The existing CE cache manager remains the only image downloader; its file directory moves to application support with a best-effort legacy copy.

**Tech Stack:** Flutter/Dart, `cached_network_image_ce`, `path_provider`, `http`, existing `ServiceApi`, Flutter test.

## Global Constraints

- Consume only Service HTTP(S) resource URLs; never load a Service host `file://`, bare filesystem path, or mobile `content://` URI.
- Do not add another image downloader or cache implementation.
- Keep `cached_network_image_ce` request headers, normalized URL identity, LRU policy, clear behavior, and current UI dimensions.
- Put CE image files and metadata under application support so normal restart/system cache reclamation does not remove them.
- Preserve all unrelated dirty-worktree UI, playback-history, theme, routing, and visual changes.
- Service plan `docs/superpowers/plans/2026-08-15-service-library-resources.md` must define `pictureUrl` and `lyricsUrl` before real integration verification.
- Do not stage or commit unless the user separately authorizes it.

---

### Task 1: Resolve Local-library Resource URLs at the Repository Boundary

**Files:**
- Modify: `lib/features/library/library_repository.dart`
- Modify: `lib/api/models.dart`
- Modify: `test/features/library/local_library_controller_test.dart`
- Modify: `test/features/library/local_library_screen_test.dart`

**Interfaces:**
- Consumes: Service `LibraryTrack` JSON with optional relative `pictureUrl` and `lyricsUrl`.
- Produces: `LibraryTrack.pictureUrl`, `LibraryTrack.lyricsUrl`, an absolute same-origin `track.raw['pic']`, and a relative same-origin `track.raw['meta']['lyricsUrl']`.

- [ ] **Step 1: Add failing repository/model tests**

Return this fixture from `/api/v1/library/tracks`:

```dart
{
  'id': 'file-a',
  'musicInfo': {
    'id': 'track-a',
    'name': 'A',
    'source': 'local',
    'meta': {'songId': 'track-a'},
  },
  'pictureUrl': '/api/v1/library/tracks/file-a/picture',
  'lyricsUrl': '/api/v1/library/tracks/file-a/lyrics',
  'size': 12,
  'extension': 'mp3',
  'streamUrl': '/api/v1/library/tracks/file-a/stream',
}
```

Assert:

```dart
expect(item.pictureUrl, Uri.parse('http://service.local/api/v1/library/tracks/file-a/picture'));
expect(item.lyricsPath, '/api/v1/library/tracks/file-a/lyrics');
expect(item.track.raw['pic'], 'http://service.local/api/v1/library/tracks/file-a/picture');
expect((item.track.raw['meta'] as Map)['lyricsUrl'], '/api/v1/library/tracks/file-a/lyrics');
```

Add malformed/external values and assert `ServiceException('INVALID_RESPONSE', ...)` rather than accepting another origin or a filesystem scheme.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
flutter test test/features/library/local_library_controller_test.dart
```

Expected: FAIL because `LibraryTrack` has no resource fields and the repository does not normalize paths.

- [ ] **Step 3: Implement strict same-origin resource normalization**

In `LibraryRepository`, map each raw item before `LibraryTrack.fromJson`. Accept only exact same-origin absolute paths beginning with `/api/v1/library/tracks/`, with the final segment matching `picture` or `lyrics`, no authority, scheme, query, or fragment. Resolve picture paths through `api.origin.resolve(path).toString()` and inject the result into `musicInfo.pic`. Preserve the validated relative lyrics path in `musicInfo.meta.lyricsUrl` for `ServiceApi.request`.

Extend `LibraryTrack`:

```dart
final Uri? pictureUrl;
final String? lyricsPath;
```

Keep both optional for older Service versions and files without resources.

- [ ] **Step 4: Verify GREEN and local list propagation**

Run:

```bash
flutter test test/features/library/local_library_controller_test.dart test/features/library/local_library_screen_test.dart
```

Expected: PASS; desktop and mobile local-library artwork widgets receive the absolute Service URL and files without artwork keep the fallback.

- [ ] **Step 5: Review the boundary diff**

Run:

```bash
git diff --check -- lib/features/library/library_repository.dart lib/api/models.dart test/features/library/local_library_controller_test.dart test/features/library/local_library_screen_test.dart
```

Expected: no whitespace errors and no generic `Track.fromJson` dependency on a global Service origin.

---

### Task 2: Route Local Lyrics Through the Service Resource

**Files:**
- Modify: `lib/features/search/search_repository.dart`
- Modify: `test/features/repositories_test.dart`

**Interfaces:**
- Consumes: validated `track.raw['meta']['lyricsUrl']` from Task 1.
- Produces: `SearchRepository.lyrics` uses GET for a local Service resource and preserves the current catalog POST for online tracks.

- [ ] **Step 1: Add failing local/online route selection tests**

Create one local track with `meta.lyricsUrl` and one online track. Assert:

```dart
await repository.lyrics(localTrack);
await repository.lyrics(onlineTrack);
expect(calls.map((call) => (call.method, call.url.path)), [
  ('GET', '/api/v1/library/tracks/file-a/lyrics'),
  ('POST', '/api/v1/catalog/tracks/lyrics'),
]);
```

Also assert a local track without `lyricsUrl` returns `const Lyrics(original: '')` without
calling a catalog source named `local`.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
flutter test test/features/repositories_test.dart --plain-name "local lyrics"
```

Expected: FAIL because every track currently posts to the catalog lyrics route.

- [ ] **Step 3: Add the local branch**

Implement:

```dart
Future<Lyrics> lyrics(Track track) async {
  final meta = track.raw['meta'];
  final localPath = meta is Map ? meta['lyricsUrl'] : null;
  if (track.source == 'local') {
    if (localPath is! String) return const Lyrics(original: '');
    return Lyrics.fromJson(await api.request('GET', localPath));
  }
  return Lyrics.fromJson(await api.request(
    'POST',
    '/api/v1/catalog/tracks/lyrics',
    body: {'source': track.source, 'musicInfo': track.toJson()},
  ));
}
```

Rely on `ServiceApi.request` to enforce same-origin absolute paths.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
flutter test test/features/repositories_test.dart
```

Expected: PASS for local GET and unchanged online catalog POST behavior.

---

### Task 3: Persist CE Artwork Across Cache-instance Restarts

**Files:**
- Modify: `lib/storage/app_image_cache.dart`
- Modify: `lib/main.dart`
- Modify: `test/storage/app_image_cache_test.dart`

**Interfaces:**
- Consumes: application support directory and optional legacy application-cache `image-cache` directory.
- Produces:
  - `copyLegacyImageCacheIfNeeded({ required Directory legacy, required Directory persistent }): Future<void>`
  - primary `CeAppImageCache.cacheBaseDirectory` below application support.

- [ ] **Step 1: Add failing restart/offline and migration tests**

Use the same `cacheBase` and `metadataBase` with two cache instances:

```dart
final first = CeAppImageCache(
  cacheBaseDirectory: cacheBase,
  metadataBaseDirectory: metadataBase,
  httpClientFactory: () => onlineClient,
);
await first.manager.getFileStream(url, withProgress: false)
  .firstWhere((event) => event is FileInfo);
await first.dispose();

final restarted = CeAppImageCache(
  cacheBaseDirectory: cacheBase,
  metadataBaseDirectory: metadataBase,
  httpClientFactory: () => MockClient((_) async => throw StateError('offline')),
);
final hit = await restarted.manager.getFileStream(url, withProgress: false)
  .firstWhere((event) => event is FileInfo) as FileInfo;
expect(hit.source, FileSource.Cache);
```

Add a legacy directory fixture and assert `copyLegacyImageCacheIfNeeded` copies nested files when the persistent target is absent, leaves an existing target untouched, and never deletes the legacy source.

- [ ] **Step 2: Run the cache test and verify RED**

Run:

```bash
flutter test test/storage/app_image_cache_test.dart
```

Expected: FAIL because the migration helper does not exist; retain the restart test as proof of CE persistence when the directory itself is persistent.

- [ ] **Step 3: Implement best-effort legacy copying and support-directory ownership**

Add a recursive copy helper using `Directory.list`, relative paths, `Directory.create`, and `File.copy`; validate that both arguments are explicit child directories supplied by `main`, never broad roots. Skip when legacy is absent or persistent already exists. Do not delete the old cache.

In `main.dart`:

```dart
final persistentImageDirectory = Directory(
  '${support.path}${Platform.pathSeparator}image-cache',
);
try {
  final appCache = await getApplicationCacheDirectory();
  await copyLegacyImageCacheIfNeeded(
    legacy: Directory('${appCache.path}${Platform.pathSeparator}image-cache'),
    persistent: persistentImageDirectory,
  );
} on Object catch (error) {
  debugPrint('Legacy image cache migration skipped: $error');
}
```

Create the primary `CeAppImageCache` with `persistentImageDirectory` and the existing support metadata directory. Retain a distinct support fallback only for genuine primary initialization failures.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
flutter test test/storage/app_image_cache_test.dart test/app/app_image_cache_scope_test.dart
```

Expected: PASS, including offline cache hit after manager recreation, safe copy, clear, usage, and scope ownership.

- [ ] **Step 5: Review cache changes**

Run:

```bash
git diff --check -- lib/storage/app_image_cache.dart lib/main.dart test/storage/app_image_cache_test.dart
```

Expected: no whitespace errors; no manual HTTP image downloader and no deletion of legacy files.

---

### Task 4: Visible Fallback and Cross-consumer Artwork Regression

**Files:**
- Modify: `lib/features/library/local_library_screen.dart`
- Modify: `lib/features/downloads/downloads_screen.dart`
- Modify: `test/features/library/local_library_screen_test.dart`
- Modify: `test/features/downloads/downloads_screen_test.dart`
- Modify: `test/features/player/player_screen_test.dart`

**Interfaces:**
- Consumes: absolute `track.raw['pic']` from Task 1 and shared `AppArtwork`.
- Produces: local/download lists never render transparent empty artwork on missing/failed resources; player receives the same URL identity.

- [ ] **Step 1: Add failing fallback and player propagation tests**

For a local item without `pictureUrl`, assert the deterministic fallback key exists on mobile and desktop. For an item with a Service picture URL, assert the `CachedNetworkImage.imageUrl` is the absolute Service URL and the player queue/current track keeps it after tapping Play.

For downloads without picture data, assert an artwork fallback is visible instead of an empty `SizedBox`.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
flutter test \
  test/features/library/local_library_screen_test.dart \
  test/features/downloads/downloads_screen_test.dart \
  test/features/player/player_screen_test.dart
```

Expected: missing-cover cases fail because local/download widgets currently pass `showFallback: false`.

- [ ] **Step 3: Use the shared fallback without changing geometry**

Remove `showFallback: false` only from local-library and download artwork positions covered by the tests. Keep existing seeds, sizes, radii, semantics, and `AppArtwork` behavior. Do not change gallery-specific fallback policy outside these screens.

- [ ] **Step 4: Verify GREEN**

Run the same three-test command. Expected: PASS with identical dimensions and visible deterministic fallbacks.

---

### Task 5: Flutter Verification and Frozen Diff

**Files:**
- Verify all Flutter files changed in Tasks 1–4.

**Interfaces:**
- Consumes: completed Flutter implementation and the Service resource contract.
- Produces: verified cross-restart image behavior and local resource propagation.

- [ ] **Step 1: Format affected Dart files**

Run:

```bash
dart format \
  lib/api/models.dart \
  lib/features/library/library_repository.dart \
  lib/features/library/local_library_screen.dart \
  lib/features/search/search_repository.dart \
  lib/features/downloads/downloads_screen.dart \
  lib/storage/app_image_cache.dart \
  lib/main.dart \
  test/features/library/local_library_controller_test.dart \
  test/features/library/local_library_screen_test.dart \
  test/features/repositories_test.dart \
  test/features/downloads/downloads_screen_test.dart \
  test/features/player/player_screen_test.dart \
  test/storage/app_image_cache_test.dart
```

Expected: exit 0.

- [ ] **Step 2: Run focused Flutter tests**

Run:

```bash
flutter test \
  test/storage/app_image_cache_test.dart \
  test/design/artwork_test.dart \
  test/features/library/local_library_controller_test.dart \
  test/features/library/local_library_screen_test.dart \
  test/features/repositories_test.dart \
  test/features/downloads/downloads_screen_test.dart \
  test/features/player/player_screen_test.dart
```

Expected: PASS.

- [ ] **Step 3: Analyze affected production files**

Run:

```bash
flutter analyze \
  lib/api/models.dart \
  lib/features/library/library_repository.dart \
  lib/features/library/local_library_screen.dart \
  lib/features/search/search_repository.dart \
  lib/features/downloads/downloads_screen.dart \
  lib/storage/app_image_cache.dart \
  lib/main.dart
```

Expected: no issues.

- [ ] **Step 4: Freeze and inspect the Flutter diff**

Run:

```bash
git diff --check
git status --short
git diff -- lib/api/models.dart lib/features/library/library_repository.dart lib/features/library/local_library_screen.dart lib/features/search/search_repository.dart lib/features/downloads/downloads_screen.dart lib/storage/app_image_cache.dart lib/main.dart
```

Expected: no whitespace errors; unrelated design/player/history work remains untouched. Leave all changes unstaged and uncommitted.

- [ ] **Step 5: Perform the cross-repository contract check**

With the Service focused tests passing, verify one fixture response contains a relative `pictureUrl`, the Flutter repository resolves it to the configured Service origin, and a recreated CE manager returns `FileSource.Cache` with its HTTP client offline.

Expected: the Service never exposes a filesystem path, the Flutter client never constructs a cover filename, and neither process reparses/redownloads unchanged artwork after its persistent cache is populated.
