# Multi-provider Real Playlist Discovery Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Flutter playlist-square placeholder with real native tags, sorts, paging, online playlist detail, playback, and local-playlist import for Kuwo, Kugou, QQ Music, NetEase, and Migu through the Service API.

**Architecture:** The Service exposes three provider-neutral catalog endpoints backed by the existing bundled `songList` adapters, with provider-scoped serialization and strict opaque-ID validation. Flutter adds discovery/detail state controllers and reuses one shared catalog track-list component derived from the current search results; the client never calls provider hosts directly.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Fastify 5, TypeBox, Vitest 4; Flutter 3.35/Dart 3.9, `http`, `go_router`, `shadcn_ui`, `flutter_test`.

## Global Constraints

- Implement only the approved design in `docs/superpowers/specs/2026-08-12-multi-provider-playlist-discovery-design.md`.
- Support bundled providers `kw`, `kg`, `tx`, `wy`, and `mg`; show each provider's native sorts and native tag groups without a synthetic taxonomy.
- The Flutter client must communicate only with Service API v1, never directly with provider endpoints.
- `playlistId`, `tagId`, and `sortId` are opaque strings; preserve them byte-for-byte across normalized responses and requests.
- Playlist detail must reject URLs, `://`, control characters, `###`, values over 512 Unicode code points, and provider-invalid IDs before invoking a legacy adapter.
- Serialize `tags`, `browse`, and `detail` calls per provider; different providers may run concurrently.
- Missing author, description, image, track count, total, or play count remains missing; do not synthesize metadata.
- Use the current search list as the single visual and interaction reference for catalog track rows on desktop and mobile.
- Complete-playlist import fetches pages sequentially and adds tracks in sequential batches of at most 100; successful batches are not rolled back.
- Preserve all unrelated user changes. Do not commit, push, publish, or deploy without explicit authorization.

---

## File Structure

### Service repository: `/Volumes/ext/lx-music-server-web`

- Modify `src/server/tuneFlowSdk/index.ts`: provider protocol declarations, discovery DTOs, normalization, opaque-ID validation, provider queue, and exported discovery methods.
- Modify `src/server/api/schemas/domain.ts`: add optional `playCount` to `CatalogCollection`.
- Modify `src/server/routes/catalog.ts`: TypeBox request/response schemas and three catalog routes.
- Modify `src/server/tuneFlowSdk/index.test.ts`: five-provider normalization, validation, and serialization tests.
- Modify `src/server/routes/catalog.test.ts`: capability and route-envelope tests.
- Modify `src/server/api/openapi.test.ts`: new path and schema assertions.
- Create `test/integration/real-playlist-discovery.test.ts`: optional real-upstream matrix gated by `TUNEFLOW_REAL_PLAYLISTS=1`.

### Flutter repository: `/Volumes/ext/MusicFree/flutter-client`

- Modify `lib/api/models.dart`: discovery capability, tags, browse page, online detail page, and collection play-count models.
- Modify `lib/features/search/search_repository.dart`: Service calls for tags, browse, and detail.
- Create `lib/features/catalog/catalog_track_list.dart`: shared desktop/mobile catalog track list extracted from search rendering.
- Modify `lib/features/search/search_desktop_results.dart`: consume the shared desktop list.
- Modify `lib/features/search/search_mobile_results.dart`: consume the shared mobile list.
- Create `lib/features/discovery/playlist_discovery_controller.dart`: provider/filter/page state and stale-request suppression.
- Create `lib/features/discovery/playlist_discovery_view.dart`: compact filters, expandable categories/bottom sheet, real cards, counts, and paging.
- Modify `lib/features/discovery/discovery_screen.dart`: delegate the playlist branch to `PlaylistDiscoveryView` and retain leaderboard behavior.
- Create `lib/features/discovery/online_playlist_detail_controller.dart`: paged detail and complete-playlist import state.
- Create `lib/features/discovery/online_playlist_detail_screen.dart`: real metadata, shared track list, playback, add-track, and complete import interactions.
- Modify `lib/app/app_router.dart`: route discovery cards to `/square/:source/:playlistId` and inject repositories/player/download actions.
- Modify `test/visual/high_fidelity_fixtures.dart`: fixture responses for capability, tags, browse, and detail.
- Modify `test/visual/full_ui_gallery_test.dart`: render online playlist detail and updated square fixtures.
- Modify `test/integration/real_catalog_sources_test.dart`: optional real Service discovery coverage.
- Create focused tests listed in Tasks 4–9.

---

### Task 1: Service discovery protocol and normalized DTOs

**Files:**
- Modify: `src/server/tuneFlowSdk/index.ts`
- Modify: `src/server/api/schemas/domain.ts`
- Test: `src/server/tuneFlowSdk/index.test.ts`

**Interfaces:**
- Consumes: legacy provider methods `songList.sortList`, `songList.getTags()`, `songList.getList(sortId, tagId, page)`, and `songList.getListDetail(playlistId, page)`.
- Produces: `PlaylistDiscoveryFilters`, `PlaylistBrowseResult`, `PlaylistDetailResult`, `getPlaylistTags(source)`, `browsePlaylists(input)`, and `getPlaylistDetail(input)` for routes in Task 3.

- [ ] **Step 1: Add failing DTO normalization tests for all five providers**

Add table-driven tests that mock each provider's native result and assert the normalized contract. Include numeric tag/sort IDs, Kuwo composite IDs, nullable metadata, `desc` versus `description`, and `play_count`.

```ts
it.each([
  ['kw', { tags: [{ name: '主题', list: [{ id: '2189-10000', name: '短视频' }] }], hotTag: [{ id: '2189-10000', name: '短视频' }], source: 'kw' }],
  ['kg', { tags: [{ name: '语种', list: [{ id: 1, name: '华语' }] }], hotTag: [], source: 'kg' }],
  ['tx', { tags: [{ name: '流派', list: [{ id: 2, name: '流行' }] }], hotTag: [], source: 'tx' }],
  ['wy', { tags: [{ name: '场景', list: [{ id: '夜晚', name: '夜晚' }] }], hotTag: [], source: 'wy' }],
  ['mg', { tags: [{ name: '主题', list: [{ id: '100', name: '经典' }] }], hotTag: [], source: 'mg' }],
] as const)('normalizes %s playlist discovery filters', async(source, native)) => {
  vi.spyOn(musicSdk[source].songList, 'getTags').mockResolvedValue(native)
  await expect(getPlaylistTags(source)).resolves.toMatchObject({
    source,
    groups: expect.any(Array),
    hotTags: expect.any(Array),
    sorts: expect.any(Array),
  })
})
```

Also add browse/detail assertions:

```ts
expect(result.list[0]).toMatchObject({
  id: 'digest-8__3677488020',
  kind: 'playlist',
  source: 'kw',
  name: 'Fixture playlist',
  author: 'Fixture author',
  total: 41,
  playCount: '450.4万',
})
expect(detail).toMatchObject({ page: 1, limit: 1000, total: 41, hasMore: false })
expect(detail.tracks[0]).toMatchObject({ id: expect.any(String), source: 'kw' })
```

- [ ] **Step 2: Run the focused test and confirm the new exports are missing**

Run:

```bash
cd /Volumes/ext/lx-music-server-web
npm exec vitest run src/server/tuneFlowSdk/index.test.ts
```

Expected: FAIL because the discovery exports and normalized fields do not exist.

- [ ] **Step 3: Define exact legacy provider and normalized interfaces**

In `src/server/tuneFlowSdk/index.ts`, extend `Provider.songList` without weakening existing method checks:

```ts
interface LegacyPlaylistTag { id: string | number, name: string }
interface LegacyPlaylistTagGroup { name: string, list: LegacyPlaylistTag[] }

interface PlaylistProvider {
  search?: (text: string, page: number, limit: number) => Promise<unknown>
  sortList?: Array<{ id: string | number, name: string }>
  getTags?: () => Promise<unknown>
  getList?: (sortId: string, tagId: string, page: number) => Promise<unknown>
  getListDetail?: (playlistId: string, page: number) => Promise<unknown>
}

export interface PlaylistTag { id: string, name: string }
export interface PlaylistTagGroup { name: string, tags: PlaylistTag[] }
export interface PlaylistDiscoveryFilters {
  source: string
  sorts: PlaylistTag[]
  hotTags: PlaylistTag[]
  groups: PlaylistTagGroup[]
}
export interface PlaylistBrowseResult {
  source: string
  page: number
  limit: number
  total: number | null
  hasMore: boolean
  list: CatalogCollection[]
}
export interface PlaylistDetailResult {
  source: string
  page: number
  limit: number
  total: number | null
  hasMore: boolean
  playlist: CatalogCollection
  tracks: Array<Record<string, unknown>>
}
```

Add `CatalogCollection` to the existing type import from `../sources/types`. Do not widen the existing `CollectionSearchResult`, whose search endpoint continues to require numeric totals.

Change `Provider.songList` to `PlaylistProvider` and extend `ProviderSummary` with optional discovery flags:

```ts
playlistDiscovery?: { tags: boolean, browse: boolean, detail: boolean }
```

- [ ] **Step 4: Implement minimal normalization helpers**

Add focused helpers and reuse them from search/browse/detail:

```ts
const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value == null) throw protocolError(`Invalid ${label} response`)
  return value as Record<string, unknown>
}

const normalizeTag = (value: unknown): PlaylistTag => {
  const tag = asRecord(value, 'playlist tag')
  const id = String(tag.id ?? '')
  const name = String(tag.name ?? '')
  if (id.length === 0 || name.length === 0) throw protocolError('Playlist tag is missing required fields')
  return { id, name }
}

const normalizeCollection = (value: unknown, source: string) => {
  const item = asRecord(value, 'playlist')
  const id = String(item.id ?? '')
  if (id.length === 0) throw protocolError('Playlist is missing an id')
  return {
    ...item,
    id,
    kind: 'playlist' as const,
    name: String(item.name ?? ''),
    source: typeof item.source === 'string' ? item.source : source,
    ...(item.play_count != null ? { playCount: String(item.play_count) } : {}),
    ...(typeof item.desc === 'string' ? { description: item.desc } : {}),
  }
}
```

Normalize `total` to `number | null`, retain upstream `page`/`limit`, and compute `hasMore` as `total != null ? page * limit < total : list.length >= limit && limit > 0`. For detail, pass the native track page through `SourceWorkerHost.normalizeSearchResult` and build playlist metadata from native `info` plus the requested ID/source.

Add optional `playCount` to the TypeBox domain schema:

```ts
playCount: Type.Optional(Type.String()),
```

- [ ] **Step 5: Re-run the focused tests**

Run:

```bash
npm exec vitest run src/server/tuneFlowSdk/index.test.ts
```

Expected: PASS for normalization tests and all pre-existing TuneFlow SDK tests.

- [ ] **Step 6: Review the task diff without committing**

Run:

```bash
git diff -- src/server/tuneFlowSdk/index.ts src/server/api/schemas/domain.ts src/server/tuneFlowSdk/index.test.ts
git diff --check
```

Expected: only Task 1 files changed; no whitespace errors. Do not commit under current authorization.

---

### Task 2: Service opaque-ID validation and provider serialization

**Files:**
- Modify: `src/server/tuneFlowSdk/index.ts`
- Test: `src/server/tuneFlowSdk/index.test.ts`

**Interfaces:**
- Consumes: Task 1 discovery methods and legacy provider adapters.
- Produces: `validatePlaylistId(source, playlistId)` and serialized `getPlaylistTags`, `browsePlaylists`, and `getPlaylistDetail` behavior relied on by routes.

- [ ] **Step 1: Add failing SSRF and concurrency tests**

Add validation cases:

```ts
it.each([
  'http://127.0.0.1/private',
  'https://example.com/list/1',
  '//example.com/list/1',
  'abc://example',
  '123###secret',
  'line\nbreak',
  'x'.repeat(513),
])('rejects unsafe playlist id %j before provider invocation', async(playlistId) => {
  const detail = vi.spyOn(musicSdk.kw.songList, 'getListDetail')
  await expect(getPlaylistDetail({ source: 'kw', playlistId, page: 1 }))
    .rejects.toMatchObject({ code: 'INVALID_PLAYLIST_ID' })
  expect(detail).not.toHaveBeenCalled()
})
```

Add positive opaque IDs for every provider, including `digest-8__3677488020` and `id_12345`. Add a deferred-promise test proving two `kw` discovery calls do not overlap, then a `kw` plus `kg` test proving different providers can overlap.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
npm exec vitest run src/server/tuneFlowSdk/index.test.ts -t 'playlist id|serializes|different providers'
```

Expected: FAIL because validation and serialization are not implemented.

- [ ] **Step 3: Implement strict provider-aware ID validation**

Use exact validators broad enough for browse-returned IDs and explicitly reject URI-like inputs first:

```ts
const playlistIdPatterns: Record<string, RegExp> = {
  kw: /^(?:digest-[A-Za-z0-9_-]+__)?[A-Za-z0-9_-]+$/,
  kg: /^(?:id_)?[A-Za-z0-9_-]+$/,
  tx: /^[A-Za-z0-9_-]+$/,
  wy: /^[A-Za-z0-9_-]+$/,
  mg: /^[A-Za-z0-9_-]+$/,
}

export const validatePlaylistId = (source: string, playlistId: string): string => {
  const points = Array.from(playlistId)
  const invalid = points.length === 0 || points.length > 512 || /[\u0000-\u001f\u007f]/.test(playlistId) ||
    playlistId.includes('://') || playlistId.startsWith('//') || playlistId.includes('###') ||
    playlistIdPatterns[source]?.test(playlistId) !== true
  if (invalid) throw Object.assign(new Error('Invalid playlist identifier'), { code: 'INVALID_PLAYLIST_ID' })
  return playlistId
}
```

If provider fixtures reveal another browse-generated character, update only that provider's allowlist and add the exact fixture to the positive test; do not fall back to arbitrary URLs.

- [ ] **Step 4: Implement a keyed promise queue**

Keep the queue internal and release it on fulfillment or rejection:

```ts
const playlistQueues = new Map<string, Promise<void>>()

const serializePlaylistCall = async<T>(source: string, work: () => Promise<T>): Promise<T> => {
  const previous = playlistQueues.get(source) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const tail = previous.catch(() => {}).then(() => gate)
  playlistQueues.set(source, tail)
  await previous.catch(() => {})
  try { return await work() } finally {
    release()
    if (playlistQueues.get(source) === tail) playlistQueues.delete(source)
  }
}
```

Wrap the native calls inside all three discovery exports. Validate detail IDs before entering the queue.

- [ ] **Step 5: Run validation, concurrency, and complete SDK tests**

Run:

```bash
npm exec vitest run src/server/tuneFlowSdk/index.test.ts
```

Expected: PASS; rejected IDs never invoke legacy detail; same-provider max concurrency is 1; cross-provider max concurrency exceeds 1.

- [ ] **Step 6: Review the task diff without committing**

Run `git diff --check` and inspect the queue cleanup path for both success and rejection. Do not commit under current authorization.

---

### Task 3: Service catalog routes, capabilities, and OpenAPI

**Files:**
- Modify: `src/server/routes/catalog.ts`
- Modify: `src/server/routes/catalog.test.ts`
- Modify: `src/server/api/openapi.test.ts`
- Test: `src/server/tuneFlowSdk/index.test.ts`

**Interfaces:**
- Consumes: Task 1/2 discovery DTOs and methods.
- Produces: `POST /api/v1/catalog/playlists/tags`, `/browse`, `/detail`, and additive `playlistDiscovery` capability consumed by Flutter.

- [ ] **Step 1: Add failing route tests**

Extend capability assertions:

```ts
expect(providers.find(provider => provider.id === 'kw')?.playlistDiscovery)
  .toEqual({ tags: true, browse: true, detail: true })
```

Inject each new route with fixture-valid bodies and assert the data envelope. Add a 400 test for additional properties/page 0 and a 400 test for `INVALID_PLAYLIST_ID`. Update `sourceFailure` to map this input code to `new ApiError(400, code, message)` before its existing 502 provider-failure mapping.

- [ ] **Step 2: Add failing OpenAPI path/schema assertions**

Add these paths to `expectedPaths`:

```ts
'/api/v1/catalog/playlists/tags',
'/api/v1/catalog/playlists/browse',
'/api/v1/catalog/playlists/detail',
```

Assert required response fields:

```ts
expect(successDataSchema('/api/v1/catalog/playlists/tags').required)
  .toEqual(expect.arrayContaining(['source', 'sorts', 'hotTags', 'groups']))
expect(successDataSchema('/api/v1/catalog/playlists/browse').required)
  .toEqual(expect.arrayContaining(['source', 'page', 'limit', 'hasMore', 'list']))
expect(successDataSchema('/api/v1/catalog/playlists/detail').required)
  .toEqual(expect.arrayContaining(['source', 'page', 'limit', 'hasMore', 'playlist', 'tracks']))
```

- [ ] **Step 3: Run route/OpenAPI tests and confirm missing routes**

Run:

```bash
npm exec vitest run src/server/routes/catalog.test.ts src/server/api/openapi.test.ts
```

Expected: FAIL because capability and routes are absent.

- [ ] **Step 4: Add TypeBox inputs and response schemas**

Define exact inputs with `additionalProperties: false`:

```ts
const PlaylistSourceInput = Type.Object({ source: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const PlaylistBrowseInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  sortId: Type.String(),
  tagId: Type.String(),
  page: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
const PlaylistDetailInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  playlistId: Type.String({ minLength: 1, maxLength: 512 }),
  page: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
```

Define `PlaylistTag`, `PlaylistTagGroup`, `PlaylistFilters`, a reusable nullable-total page schema, and detail schema. `total` must be `Type.Union([Type.Number(), Type.Null()])`; `playCount` remains optional on `CatalogCollection`.

- [ ] **Step 5: Register routes and capability flags**

Use unique operation IDs:

```ts
getCatalogPlaylistTags
browseCatalogPlaylists
getCatalogPlaylistDetail
```

Each handler returns `{ data: await ... }` and converts native failures through `sourceFailure` with distinct messages. `catalogCapabilities()` advertises discovery only when all of `getTags/getList/getListDetail` exist.

- [ ] **Step 6: Run Service contract verification**

Run:

```bash
npm exec vitest run src/server/tuneFlowSdk/index.test.ts src/server/routes/catalog.test.ts src/server/api/openapi.test.ts
npm run build:server
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 7: Freeze the Service-side boundary for Flutter work**

Run:

```bash
git diff --check
git status --short
```

Record the three request/response examples from the approved spec against the generated OpenAPI. Do not commit under current authorization.

---

### Task 4: Flutter discovery models and repository contract

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/api/models.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_repository.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/api/models_test.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/discovery/playlist_discovery_repository_test.dart`

**Interfaces:**
- Consumes: Task 3 Service JSON contract.
- Produces: `PlaylistDiscoveryCapability`, `CatalogTag`, `CatalogTagGroup`, `PlaylistDiscoveryFilters`, `PlaylistBrowsePage`, `OnlinePlaylistPage`, and repository methods used by Tasks 6 and 8.

- [ ] **Step 1: Add failing model tests for capability and all page types**

Use exact fixtures:

```dart
final provider = CatalogProvider.fromJson({
  'id': 'kw',
  'name': '酷我音乐',
  'searchKinds': ['track', 'playlist'],
  'leaderboards': true,
  'playlistDiscovery': {'tags': true, 'browse': true, 'detail': true},
});
expect(provider.playlistDiscovery?.browse, isTrue);

final filters = PlaylistDiscoveryFilters.fromJson({
  'source': 'kw',
  'sorts': [{'id': 'hot', 'name': '最热'}],
  'hotTags': [{'id': '2189-10000', 'name': '短视频'}],
  'groups': [{'name': '主题', 'tags': [{'id': '1265-10000', 'name': '经典'}]}],
});
expect(filters.groups.single.tags.single.id, '1265-10000');
```

Assert nullable `total`, optional `playCount`, `hasMore`, and strict invalid-field failures.

- [ ] **Step 2: Add failing repository request tests**

Use `MockClient` and record JSON bodies. Assert:

```dart
await repository.playlistTags(source: 'kw');
await repository.browsePlaylists(source: 'kw', sortId: 'hot', tagId: '', page: 2);
await repository.onlinePlaylist(source: 'kw', playlistId: 'digest-8__1', page: 1);
```

Expected paths and bodies must match Task 3 exactly.

- [ ] **Step 3: Run tests and confirm missing types/methods**

Run:

```bash
cd /Volumes/ext/MusicFree/flutter-client
flutter test test/api/models_test.dart test/features/discovery/playlist_discovery_repository_test.dart
```

Expected: compile FAIL because the new models and methods do not exist.

- [ ] **Step 4: Implement strict immutable Dart models**

Add:

```dart
final class PlaylistDiscoveryCapability {
  const PlaylistDiscoveryCapability({required this.tags, required this.browse, required this.detail});
  final bool tags;
  final bool browse;
  final bool detail;
}

final class CatalogTag { const CatalogTag({required this.id, required this.name}); final String id; final String name; }
final class CatalogTagGroup { const CatalogTagGroup({required this.name, required this.tags}); final String name; final List<CatalogTag> tags; }
```

Add `playCount` to `CatalogCollection`. Define `PlaylistBrowsePage` and `OnlinePlaylistPage` with `int page`, `int limit`, `int? total`, and `bool hasMore`; detail additionally has `CatalogCollection playlist` and `List<Track> tracks`.

- [ ] **Step 5: Implement repository calls**

Add exact signatures:

```dart
Future<PlaylistDiscoveryFilters> playlistTags({required String source})
Future<PlaylistBrowsePage> browsePlaylists({required String source, required String sortId, required String tagId, required int page})
Future<OnlinePlaylistPage> onlinePlaylist({required String source, required String playlistId, required int page})
```

Use `ServiceApi.request` and the model factories; do not add a direct `http` dependency or provider URL logic.

- [ ] **Step 6: Format and run focused tests**

Run:

```bash
dart format lib/api/models.dart lib/features/search/search_repository.dart test/api/models_test.dart test/features/discovery/playlist_discovery_repository_test.dart
flutter test test/api/models_test.dart test/features/discovery/playlist_discovery_repository_test.dart
```

Expected: PASS.

- [ ] **Step 7: Review the task diff without committing**

Run `git diff --check` only if the Flutter directory is a Git worktree; otherwise use `dart format --output=none --set-exit-if-changed` on changed Dart files and inspect the files directly. Do not commit.

---

### Task 5: Shared catalog track list extracted from search

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/catalog/catalog_track_list.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_desktop_results.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_mobile_results.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/catalog/catalog_track_list_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/features/search/search_screen_test.dart`

**Interfaces:**
- Consumes: existing `Track`, `CatalogProvider`, `SearchTrackMetadata`, `SearchTrackArtwork`, `TrackAction`, and adaptive action menu.
- Produces: `CatalogTrackList`, a configurable shared renderer used by search in this task and online detail in Task 9.

- [ ] **Step 1: Add a failing shared-list contract test**

Test desktop and mobile variants with the same tracks:

```dart
await tester.pumpWidget(harness(CatalogTrackList(
  tracks: const [fixtureTrack],
  page: 2,
  pageSize: 30,
  total: 31,
  providers: const [CatalogProvider(id: 'kw', name: '酷我', searchKinds: {CatalogSearchKind.track})],
  aggregate: false,
  mobile: false,
  loadPicture: (_) async => null,
  onPlay: (_) {},
  onFavorite: (_) {},
  actionsFor: (_) => const [],
  onPage: (_) {},
)));
expect(find.text('31'), findsOneWidget);
expect(find.byKey(const Key('catalog-track-kw-track-1')), findsOneWidget);
expect(find.text('专辑'), findsOneWidget);
```

For mobile, assert the title/metadata and 44×44 favorite/more targets, with desktop-only headers absent.

- [ ] **Step 2: Run the shared-list test and confirm the widget is missing**

Run:

```bash
flutter test test/features/catalog/catalog_track_list_test.dart
```

Expected: compile FAIL because `CatalogTrackList` does not exist.

- [ ] **Step 3: Extract rendering without changing search behavior**

Create a public widget with exact configuration:

```dart
final class CatalogTrackList extends StatelessWidget {
  const CatalogTrackList({
    super.key,
    required this.tracks,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.providers,
    required this.aggregate,
    required this.mobile,
    required this.loadPicture,
    required this.onPlay,
    required this.onFavorite,
    required this.actionsFor,
    this.onPage,
    this.scrollController,
    this.loadingMore = false,
    this.loadMoreError,
    this.onRetry,
  });
  // fields exactly mirror constructor parameters
}
```

Move the current desktop header/row/pagination and mobile row behavior into this file. Preserve current keys or add stable `catalog-*` keys and update search tests once; do not redesign spacing, breakpoints, gestures, artwork, metadata, or action buttons.

- [ ] **Step 4: Replace private search rows with the shared widget**

In desktop search, pass `SearchController.pageSize`, `section.page`, `section.total`, and `onPage`. In mobile search, preserve infinite loading by passing `loadingMore`, `loadMoreError`, and `onRetry`; keep its outer `ScrollController` behavior.

- [ ] **Step 5: Run search and shared-list regression tests**

Run:

```bash
flutter test test/features/catalog/catalog_track_list_test.dart test/features/search/search_screen_test.dart test/features/search/adaptive_track_actions_test.dart test/features/search/track_action_sheet_test.dart test/features/search/track_action_test.dart
```

Expected: PASS with existing search interaction behavior unchanged.

- [ ] **Step 6: Format and review without committing**

Run `dart format` on Task 5 files, then `flutter analyze` if focused tests expose no compile warnings. Do not commit.

---

### Task 6: Flutter playlist discovery controller

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/playlist_discovery_controller.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/discovery/playlist_discovery_controller_test.dart`

**Interfaces:**
- Consumes: Task 4 `SearchRepository` discovery methods and `CatalogProvider.playlistDiscovery`.
- Produces: `PlaylistDiscoveryState` and `PlaylistDiscoveryController` consumed by the screen in Task 7.

- [ ] **Step 1: Add failing controller state-transition tests**

Cover:

```dart
await controller.load();
expect(controller.state.providers.map((p) => p.id), ['kw', 'kg', 'tx', 'wy', 'mg']);
expect(controller.state.source, 'kw');
expect(controller.state.sortId, 'hot'); // fixture first/default sort
expect(controller.state.page, 1);

await controller.selectTag('2189-10000');
expect(controller.state.page, 1);
expect(lastBrowseBody['tagId'], '2189-10000');
```

Also test provider switch defaults, sort reset, next/previous page, prior-result retention on page failure, tag failure without synthetic filters, and a delayed old request that completes after a new provider request but cannot publish stale state.

- [ ] **Step 2: Run the controller test and confirm missing classes**

Run:

```bash
flutter test test/features/discovery/playlist_discovery_controller_test.dart
```

Expected: compile FAIL.

- [ ] **Step 3: Implement immutable state**

Use explicit scoped fields rather than a single ambiguous error:

```dart
enum DiscoveryPhase { idle, loading, ready, empty, failure }

final class PlaylistDiscoveryState {
  const PlaylistDiscoveryState({
    this.providers = const [],
    this.source = '',
    this.filters,
    this.sortId = '',
    this.tagId = '',
    this.page = 1,
    this.items = const [],
    this.limit = 0,
    this.total,
    this.hasMore = false,
    this.phase = DiscoveryPhase.idle,
    this.filtersError,
    this.browseError,
    this.stale = false,
  });
  // immutable fields and a typed copyWith
}
```

- [ ] **Step 4: Implement controller generation and transitions**

Use an integer generation incremented for every provider/filter/page request. Only the current generation may publish. Public methods:

```dart
Future<void> load()
Future<void> selectProvider(String source)
Future<void> selectSort(String sortId)
Future<void> selectTag(String tagId)
Future<void> goToPage(int page)
Future<void> retryFilters()
Future<void> retryBrowse()
```

`load()` filters capability providers by `playlistDiscovery?.browse == true && playlistDiscovery?.detail == true`. Provider/filter changes reset to page 1. A failed subsequent browse preserves `items` and marks `stale`.

- [ ] **Step 5: Run and format controller tests**

Run:

```bash
dart format lib/features/discovery/playlist_discovery_controller.dart test/features/discovery/playlist_discovery_controller_test.dart
flutter test test/features/discovery/playlist_discovery_controller_test.dart
```

Expected: PASS.

- [ ] **Step 6: Review without committing**

Inspect every async completion for the generation check and every failure path for retained state. Do not commit.

---

### Task 7: Real playlist-square UI

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/playlist_discovery_view.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/discovery_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/app_router.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/discovery/playlist_discovery_screen_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/visual/high_fidelity_fixtures.dart`

**Interfaces:**
- Consumes: Task 6 controller/state.
- Produces: approved compact/expandable discovery UI and `ValueChanged<CatalogCollection> onOpenPlaylist` navigation callback.

- [ ] **Step 1: Add failing widget tests for approved behavior**

Test wide and mobile widths. Required assertions:

```dart
expect(find.text('为你推荐'), findsNothing);
expect(find.text('第 1 / 18 页'), findsNothing);
expect(find.text('最热歌单'), findsOneWidget);
expect(find.text('1 / 49'), findsOneWidget);
expect(find.text('共 1751 个'), findsOneWidget);
expect(find.byKey(const Key('playlist-categories-toggle')), findsOneWidget);
```

Tap `全部分类` on desktop and assert native group/tag labels. On mobile, assert `showAppSheet` content. Tap a card and assert the callback receives the exact `source` and opaque ID.

- [ ] **Step 2: Run the widget test and confirm current placeholders fail**

Run:

```bash
flutter test test/features/discovery/playlist_discovery_screen_test.dart
```

Expected: FAIL because the screen still performs fixed keyword search and fake paging.

- [ ] **Step 3: Split playlist and leaderboard branches cleanly**

Keep `DiscoveryScreen` as the route surface and move the playlist branch into `PlaylistDiscoveryView` in `playlist_discovery_view.dart`. The playlist view takes a `PlaylistDiscoveryController`; leaderboard keeps `SearchRepository` and playback callback.

Use the approved header, provider chips, visible sort/hot-tag chips, expandable grouped categories, real `PlaylistCard`s, and API-derived pager. Do not display missing metadata separators.

- [ ] **Step 4: Implement route callback without adding detail UI yet**

Change playlist navigation to:

```dart
onOpenPlaylist: (playlist) => context.goNamed(
  'online-playlist',
  pathParameters: {'source': playlist.source, 'playlistId': playlist.id},
),
```

The named route is added in Task 9. In Task 7 widget tests, pass a recording callback directly; application compilation does not require named-route registration until navigation is exercised.

- [ ] **Step 5: Update visual fixtures to return real filter/browse payloads**

Add `/catalog/playlists/tags` and `/catalog/playlists/browse` branches. Capability fixtures must include `playlistDiscovery`. Use deterministic real-looking metadata and `total/limit/page/hasMore`; remove dependency on the fixed playlist-search response for the square.

- [ ] **Step 6: Run widget and visual harness tests**

Run:

```bash
dart format lib/features/discovery/playlist_discovery_view.dart lib/features/discovery/discovery_screen.dart lib/app/app_router.dart test/features/discovery/playlist_discovery_screen_test.dart test/visual/high_fidelity_fixtures.dart
flutter test test/features/discovery/playlist_discovery_screen_test.dart test/visual/full_ui_gallery_test.dart
```

Expected: PASS; visual gallery renders square at existing desktop/mobile widths.

- [ ] **Step 7: Review without committing**

Search the implementation:

```bash
rg -n "为你推荐|第 1 / 18 页|text: '热门'" lib/features/discovery
```

Expected: no matches in playlist discovery. Do not commit.

---

### Task 8: Online playlist detail controller and complete import

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/online_playlist_detail_controller.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/discovery/online_playlist_detail_controller_test.dart`

**Interfaces:**
- Consumes: Task 4 `SearchRepository.onlinePlaylist`, existing `PlaylistRepository`, and a caller-provided `PlayTracks` callback.
- Produces: `OnlinePlaylistDetailState`, `PlaylistImportProgress`, page loading, play-all input, and `importAll(targetPlaylistId)` for Task 9.

- [ ] **Step 1: Add failing page accumulation and partial-import tests**

Fixture two detail pages and a recording `PlaylistRepository`. Assert:

```dart
await controller.load();
await controller.loadPage(2);
expect(controller.state.tracks.map((track) => track.id), ['one', 'two']);

await controller.importAll('love');
expect(addBatchSizes, everyElement(lessThanOrEqualTo(100)));
expect(controller.state.importProgress?.added, 2);
expect(controller.state.importProgress?.completed, isTrue);
```

Add tests for later-page failure retaining page 1, cancellation at a batch boundary, and batch 2 failure preserving batch 1 with exact remaining counts.

- [ ] **Step 2: Run the controller test and confirm missing classes**

Run:

```bash
flutter test test/features/discovery/online_playlist_detail_controller_test.dart
```

Expected: compile FAIL.

- [ ] **Step 3: Implement state and page map**

Define:

```dart
final class PlaylistImportProgress {
  const PlaylistImportProgress({required this.fetched, required this.added, required this.skipped, required this.failed, required this.completed, required this.cancelled});
  final int fetched, added, skipped, failed;
  final bool completed, cancelled;
}
```

State stores `CatalogCollection? playlist`, `Map<int, OnlinePlaylistPage> pages`, ordered deduplicated tracks keyed by `(source, id)`, current/loading/failed page, error, stale flag, and import progress.

- [ ] **Step 4: Implement sequential import with retry bookkeeping**

Public API:

```dart
Future<void> load()
Future<void> loadPage(int page)
Future<void> retryFailedPage()
Future<void> importAll(String targetPlaylistId)
void cancelImport()
```

Fetch pages until `hasMore == false`. Chunk tracks with `for (var offset = 0; offset < tracks.length; offset += 100)`. Record confirmed track keys after each successful `addTracks`; same-operation retry excludes those keys. Check cancellation before every fetch and add batch.

- [ ] **Step 5: Run and format controller tests**

Run:

```bash
dart format lib/features/discovery/online_playlist_detail_controller.dart test/features/discovery/online_playlist_detail_controller_test.dart
flutter test test/features/discovery/online_playlist_detail_controller_test.dart
```

Expected: PASS for page, cancellation, and partial failure cases.

- [ ] **Step 6: Review without committing**

Confirm no `Future.wait` is used for provider pages or add batches and no rollback deletes successful tracks. Do not commit.

---

### Task 9: Online playlist detail screen, shared actions, and routing

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/online_playlist_detail_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/app_router.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/discovery/discovery_screen.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/discovery/online_playlist_detail_screen_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/visual/high_fidelity_fixtures.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/visual/full_ui_gallery_test.dart`

**Interfaces:**
- Consumes: Task 5 shared `CatalogTrackList`, Task 8 controller, existing `PlayerController`, `PlaylistRepository`, `DownloadRepository`, lyrics/picture calls, and `buildTrackActions`.
- Produces: named route `online-playlist` at `/square/:source/:playlistId` and the complete user-facing detail workflow.

- [ ] **Step 1: Add failing screen behavior tests**

Assert real metadata, absent missing fields, shared track keys, and action callbacks:

```dart
expect(find.text('短视频DJ热门歌曲｜网红BGM'), findsOneWidget);
expect(find.textContaining('450.4万'), findsOneWidget);
expect(find.byKey(const Key('catalog-track-kw-one')), findsOneWidget);
await tester.tap(find.byKey(const Key('online-playlist-play-all')));
expect(played.map((track) => track.id), ['one']);
```

Test target-playlist selection, import progress, partial failure message, retry, mobile list behavior, and that rename/delete controls from local playlist detail are absent.

- [ ] **Step 2: Run the screen test and confirm the screen is missing**

Run:

```bash
flutter test test/features/discovery/online_playlist_detail_screen_test.dart
```

Expected: compile FAIL.

- [ ] **Step 3: Implement the read-only detail screen**

Build the approved metadata hero and render only non-empty metadata. Use `CatalogTrackList` with the same callbacks/actions as search. Use the existing `SearchRepository.picture/lyrics`, `PlaylistRepository`, `DownloadRepository`, and `buildTrackActions`; preserve the same action ordering and labels asserted by existing search action tests.

Play-all fetches all remaining pages sequentially when `hasMore` is true, shows progress, then invokes the player with the complete ordered list. A page failure retains loaded tracks, reports the failure, and does not start partial playback under the “播放全部” label.

- [ ] **Step 4: Implement add-one and add-all flows**

Reuse the search target-playlist sheet for a single track. For add-all, select the target then call `controller.importAll`. Display `fetched/added/skipped/failed` and cancellation between boundaries. Never claim rollback.

- [ ] **Step 5: Add the final route**

Register:

```dart
GoRoute(
  path: '/square/:source/:playlistId',
  name: 'online-playlist',
  builder: (context, state) {
    final connected = requireConnected();
    return OnlinePlaylistDetailScreen(
      controller: OnlinePlaylistDetailController(
        catalog: SearchRepository(connected.api),
        playlists: PlaylistRepository(connected.api),
        source: state.pathParameters['source']!,
        playlistId: state.pathParameters['playlistId']!,
      ),
      player: requirePlayer(),
      downloads: DownloadRepository(connected.api),
    );
  },
),
```

Keep IDs in encoded path parameters. Task 2 validators disallow `/`, `?`, `#`, URI schemes, and control characters while allowing provider-generated hyphens/underscores, so every accepted ID is a safe single route segment. Add a router test using `digest-8__3677488020` to prove exact decoding.

- [ ] **Step 6: Update detail visual fixtures and run focused UI tests**

Run:

```bash
dart format lib/features/discovery/online_playlist_detail_screen.dart lib/app/app_router.dart lib/features/discovery/discovery_screen.dart test/features/discovery/online_playlist_detail_screen_test.dart test/visual/high_fidelity_fixtures.dart test/visual/full_ui_gallery_test.dart
flutter test test/features/catalog/catalog_track_list_test.dart test/features/discovery/playlist_discovery_screen_test.dart test/features/discovery/online_playlist_detail_screen_test.dart test/features/search/search_screen_test.dart test/visual/full_ui_gallery_test.dart
```

Expected: PASS.

- [ ] **Step 7: Review without committing**

Confirm online detail imports the shared catalog list and contains no local rename/delete implementation. Do not commit.

---

### Task 10: Cross-repository integration and frozen-result verification

**Files:**
- Create: `test/integration/real-playlist-discovery.test.ts`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/integration/real_catalog_sources_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/tool/verify_openapi.dart` only if its current contract whitelist requires the three new paths.
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/visual/full-fidelity-report.md` only if the repository's visual-audit workflow regenerates this tracked report.

**Interfaces:**
- Consumes: completed Service and Flutter implementations.
- Produces: evidence that every advertised provider returns client-consumable tags, browse, detail, and tracks without weakening offline unit tests.

- [ ] **Step 1: Add optional real-provider Service integration coverage**

Gate the test so normal `npm test` stays offline. For each discovery-capable provider:

```ts
const filters = await getPlaylistTags(source)
expect(filters.sorts.length).toBeGreaterThan(0)
const page = await browsePlaylists({ source, sortId: filters.sorts[0].id, tagId: '', page: 1 })
expect(page.list.length).toBeGreaterThan(0)
const detail = await getPlaylistDetail({ source, playlistId: page.list[0].id, page: 1 })
expect(detail.playlist.id).toBe(page.list[0].id)
expect(detail.tracks.length).toBeGreaterThan(0)
```

- [ ] **Step 2: Extend Flutter real-Service acceptance**

For every capability with browse/detail true, call `playlistTags`, `browsePlaylists`, and `onlinePlaylist`; assert opaque ID equality and at least one valid track. Keep the existing `LX_SERVICE_ORIGIN` skip behavior.

- [ ] **Step 3: Run the complete focused Service suite**

Run:

```bash
cd /Volumes/ext/lx-music-server-web
npm exec vitest run src/server/tuneFlowSdk/index.test.ts src/server/routes/catalog.test.ts src/server/api/openapi.test.ts
npm run build:server
npm run lint
```

Expected: exit 0. Run the optional real-provider test only when its explicit environment gate is available; record a skip otherwise.

- [ ] **Step 4: Run the complete focused Flutter suite**

Run:

```bash
cd /Volumes/ext/MusicFree/flutter-client
flutter test test/api/models_test.dart test/features/discovery test/features/catalog test/features/search/search_screen_test.dart test/visual/full_ui_gallery_test.dart
flutter analyze
```

Expected: exit 0.

- [ ] **Step 5: Run real Service acceptance when configured**

Run:

```bash
LX_SERVICE_ORIGIN='http://192.168.0.172:3124' flutter test test/integration/real_catalog_sources_test.dart
```

Expected: PASS if the rebuilt Service containing the new endpoints is running at that origin. If the running host is still an older build, do not deploy implicitly; report the integration check as blocked by runtime version.

- [ ] **Step 6: Freeze and inspect final repository state**

Run:

```bash
git -C /Volumes/ext/lx-music-server-web diff --check
git -C /Volumes/ext/lx-music-server-web status --short
```

In Flutter, run `dart format --output=none --set-exit-if-changed` over all changed Dart files and list all changed/new files. Confirm:

- no fake recommendation copy or hard-coded page count remains;
- no Flutter provider URL was introduced;
- no arbitrary URL reaches Service detail adapters;
- no unrelated files or generated secrets are present;
- all claimed tests correspond to captured command output.

Do not commit, push, publish, or deploy without a new explicit authorization.
