# Multi-provider real playlist discovery design

Date: 2026-08-12
Status: approved design, pending implementation plan
Repositories:

- Service: `/Volumes/ext/lx-music-server-web`
- Flutter client: `/Volumes/ext/MusicFree/flutter-client`

## 1. Outcome

Replace the Flutter playlist-square placeholder behavior with real, multi-provider playlist discovery backed by the Service. The finished feature supports Kuwo (`kw`), Kugou (`kg`), QQ Music (`tx`), NetEase (`wy`), and Migu (`mg`) using each provider's native sorts and tag groups.

Users can:

- switch between providers that advertise playlist-discovery support;
- browse the selected provider's real native tags and sorts;
- page through the real playlist result set;
- open a real online playlist detail page;
- inspect real playlist metadata and paged tracks;
- play one track or the whole loaded playlist;
- add one track or the complete online playlist to a selected local Service playlist.

The Flutter client never calls provider endpoints directly. Provider protocols remain inside the Service.

## 2. Current state and evidence

The Flutter playlist square currently performs a keyword search for the fixed text `热门`, always requests page 1, displays the literal heading `为你推荐`, shows a hard-coded `第 1 / 18 页`, and routes playlist-card clicks to the general search screen.

The Service already bundles provider SDK implementations for native playlist discovery, but its TuneFlow SDK facade and catalog routes expose only playlist keyword search.

The bundled provider capability matrix is:

| Provider | Native tags | Native browse | Detail | Native sorts exposed in v1 |
| --- | --- | --- | --- | --- |
| Kuwo (`kw`) | yes | yes | paged | latest, hottest |
| Kugou (`kg`) | yes | yes | commonly returned as one large page | recommended, hottest, latest, most collected, rising |
| QQ (`tx`) | yes | yes | returned as one page | hottest, latest |
| NetEase (`wy`) | yes | yes | paged | hot |
| Migu (`mg`) | yes | yes | paged, typically 50 tracks | recommended |

Provider-specific values such as playlist IDs, tag IDs, and sort IDs are opaque protocol values. Neither Service routes nor Flutter may split, reinterpret, or rebuild them.

## 3. Scope

### 3.1 Included

- Service facade support for native playlist tags, browse, and detail.
- Three versioned Service catalog endpoints.
- Capability advertisement for playlist discovery.
- OpenAPI schemas and contract tests.
- Per-provider serialization of native playlist-discovery calls.
- Flutter models, repository, controller/state, routing, playlist-square UI, online playlist detail UI, and focused tests.
- Shared track-list presentation and actions based on the existing search result list.
- Desktop and mobile responsive behavior.
- Partial-progress reporting for complete-playlist import.

### 3.2 Not included

- Calling music-provider APIs directly from Flutter.
- A synthetic cross-provider category taxonomy.
- Personalized recommendations.
- Arbitrary playlist share-URL import through the discovery detail endpoint.
- Adding new user-source Worker capabilities; discovery continues to use the bundled providers.
- Background synchronization of online playlists.
- Persisting discovery filters across app restarts.
- Redesigning unrelated search, leaderboard, playback, or local-playlist screens.

## 4. Architecture

```text
Flutter discovery/detail screens
        |
        | Service API v1
        v
catalog routes (validate and envelope)
        |
        v
TuneFlow SDK facade (normalize and serialize by provider)
        |
        v
bundled provider songList implementations
        |
        v
provider upstream APIs
```

The Service owns protocol differences and exposes a stable provider-neutral contract. Flutter owns view state and user interaction, not provider parsing.

### 4.1 Service boundaries

- `src/server/routes/catalog.ts` validates requests, produces the standard data envelope, and exposes OpenAPI schemas.
- `src/server/tuneFlowSdk/index.ts` declares the legacy provider capabilities, invokes provider methods, normalizes their results, and serializes discovery calls per provider.
- Existing `CatalogTrack` and `CatalogCollection` domain schemas remain the basis of normalized output.
- Bundled provider implementations under `src/renderer/utils/musicSdk/*/songList.js` remain the protocol adapters.
- Installed user-source Workers remain limited to their current playback-related actions and are not used for playlist discovery.

### 4.2 Flutter boundaries

- The existing `SearchRepository`, which already owns catalog calls, gains tags, browse, and detail methods; this task does not rename it.
- A dedicated discovery controller owns provider, sort, tag, browse page, loading, stale-data, and error state.
- A dedicated online-playlist-detail controller owns metadata, track pages, playback input, and complete-playlist import progress.
- Existing local `PlaylistDetailScreen` continues to represent editable Service playlists. Online playlist detail is a separate read-only route and must not expose rename/delete actions.
- Track rows are extracted from or directly generalized from the existing search list. The detail page must not introduce a visually or behaviorally separate track-row implementation.

## 5. Service API contract

All endpoints use the existing success/error envelope conventions.

### 5.1 Capability advertisement

Each provider in `GET /api/v1/catalog/capabilities` may include:

```json
{
  "playlistDiscovery": {
    "tags": true,
    "browse": true,
    "detail": true
  }
}
```

The property is optional for backward compatibility. Flutter shows a provider in the playlist square only when `browse` and `detail` are true. A missing property means discovery is unsupported even if playlist keyword search is supported.

### 5.2 Native tags and sorts

```http
POST /api/v1/catalog/playlists/tags
Content-Type: application/json

{ "source": "kw" }
```

```json
{
  "data": {
    "source": "kw",
    "sorts": [
      { "id": "new", "name": "最新" },
      { "id": "hot", "name": "最热" }
    ],
    "hotTags": [
      { "id": "2189-10000", "name": "短视频" }
    ],
    "groups": [
      {
        "name": "主题",
        "tags": [
          { "id": "1265-10000", "name": "经典" }
        ]
      }
    ]
  }
}
```

Tag and sort order follows the upstream provider. The Service does not merge, rename, or synthesize categories. An empty string represents the provider's default/all tag only when returned or selected by the Service contract.

### 5.3 Browse playlists

```http
POST /api/v1/catalog/playlists/browse
Content-Type: application/json

{
  "source": "kw",
  "sortId": "hot",
  "tagId": "",
  "page": 1
}
```

```json
{
  "data": {
    "source": "kw",
    "page": 1,
    "limit": 36,
    "total": 1751,
    "hasMore": true,
    "list": [
      {
        "id": "3677488020",
        "kind": "playlist",
        "name": "爱的故事翻篇，被爱的人不用道歉",
        "source": "kw",
        "author": "余笑笑",
        "total": 121,
        "img": "http://img1.kuwo.cn/example.jpg",
        "description": "",
        "playCount": "351.2万"
      }
    ]
  }
}
```

`total`, metadata fields, and `playCount` are nullable when the upstream provider omits them. `playCount` is a display-preserving string because bundled providers currently return mixed numeric and already-formatted count values. The Service must not invent missing values.

`hasMore` is normalized from reliable upstream page data. For providers that return the entire playlist set as one page, it is false after that page.

### 5.4 Playlist detail

```http
POST /api/v1/catalog/playlists/detail
Content-Type: application/json

{
  "source": "kw",
  "playlistId": "3677488020",
  "page": 1
}
```

```json
{
  "data": {
    "source": "kw",
    "page": 1,
    "limit": 1000,
    "total": 121,
    "hasMore": false,
    "playlist": {
      "id": "3677488020",
      "kind": "playlist",
      "name": "爱的故事翻篇，被爱的人不用道歉",
      "source": "kw",
      "author": "余笑笑",
      "total": 121,
      "img": "http://img1.kuwo.cn/example.jpg",
      "description": "",
      "playCount": "351.2万"
    },
    "tracks": []
  }
}
```

The response reports the provider's real page, limit, total, and continuation behavior. The Service does not pretend that providers with whole-list responses support smaller remote pages.

## 6. Validation, security, and concurrency

### 6.1 SSRF containment

Legacy provider detail functions can accept share URLs and may fetch or follow them. Exposing that behavior on a LAN API would create an SSRF surface.

The discovery detail endpoint therefore accepts only a provider playlist ID returned by browse/search:

- reject absolute URLs and any value containing a URI scheme delimiter;
- reject control characters, provider token delimiters such as `###`, and values longer than 512 Unicode code points;
- apply a provider-specific allowlist validator broad enough for that provider's real opaque IDs, including hyphens and underscores where required;
- never pass rejected input to a provider implementation;
- never log raw rejected identifiers or upstream URLs containing user-derived values.

Arbitrary share-URL import is a separate future feature and would require provider-domain allowlists, public-IP enforcement, and redirect validation on every hop.

### 6.2 Provider request serialization

Several bundled `songList` implementations are shared singletons whose methods cancel an earlier `_requestObj_*`. Concurrent discovery requests for the same provider can therefore interrupt each other.

The facade maintains a small keyed async queue/mutex per provider for `tags`, `browse`, and `detail`. Requests for different providers may run concurrently. A failed request releases the queue. Existing search and leaderboard behavior is unchanged unless tests prove it shares the same cancellation state.

## 7. Flutter experience

### 7.1 Playlist square

The approved layout is a compact filter bar with expandable native categories:

- provider chips come from capabilities;
- switching provider loads that provider's tags and selects its first/default sort and default tag;
- sort chips and a small set of hot tags stay visible;
- `全部分类`/`更多` expands the grouped native tag panel on desktop;
- mobile presents the same grouped tags in a bottom sheet;
- changing provider, sort, or tag resets browse to page 1;
- paging preserves provider, sort, and tag;
- the heading describes the selected real sort/tag rather than saying `为你推荐`;
- page count and result count come from `total`, `limit`, `page`, and `hasMore`; no literal page count remains;
- card metadata shows only real author, track count, and play count returned by Service;
- selecting a card navigates to an online playlist detail route with `source` and `playlistId`.

### 7.2 Online playlist detail

The detail page is read-only and contains:

- provider, cover, title, author, description, play count, and track count when present;
- play-all and add-complete-playlist actions;
- the globally shared track list;
- real track pagination when the provider has additional pages;
- retry controls that retain already loaded metadata or tracks where safe.

The global track list follows the existing search list as the implementation reference:

- desktop: index, artwork, title/artist/quality metadata, favorite/add action, optional album and duration columns, and the common more-actions menu;
- mobile: title and metadata with the same favorite and more actions used by search;
- the same play gesture and action semantics as search;
- common responsive thresholds and shared tests.

Search, leaderboards, online playlist detail, and local playlists should consume the shared list/row primitives where their product actions overlap. A screen may configure available actions, but not restyle the core row independently.

### 7.3 Complete-playlist import

The user chooses a target Service playlist before network work begins. The controller then:

1. starts with the detail pages already loaded;
2. fetches remaining provider detail pages sequentially using `hasMore`;
3. adds normalized tracks to the target Service playlist in sequential batches of at most 100 tracks;
4. reports fetched, added, skipped, and failed counts;
5. preserves successful batches if a later page or batch fails;
6. offers retry for the remaining work without silently re-adding confirmed successful batches during the same operation.

The UI remains cancelable between page/batch boundaries. Cancellation stops future work but does not roll back tracks already added.

## 8. State and error handling

### 8.1 Discovery state

Discovery state contains capabilities, selected provider, native filter metadata, selected sort/tag, browse page, page metadata, items, loading phase, stale flag, and scoped errors.

- Initial capability failure: full-page retry.
- Tag failure: retain provider controls, show an inline retry, and do not substitute invented filters.
- Browse initial failure: result-area retry.
- Browse page/filter failure after prior success: retain prior items as stale and show an inline error.
- Empty browse result: identify the selected provider/filter and allow filter reset.
- Rapid filter changes: only the latest controller request may publish state; Service serialization protects the legacy adapter, while the client generation token prevents stale UI commits.

### 8.2 Detail state

Detail state contains immutable source/playlist ID, playlist metadata, loaded page map, ordered tracks, page metadata, loading phase, stale flag, scoped errors, and optional import progress.

- Initial failure: retry state with back navigation.
- Later-page failure: retain loaded tracks and retry only the failed page.
- Track artwork/picture failure: use the existing artwork fallback without failing the page.
- Unsupported or rejected ID: show the Service error without attempting an alternate URL flow.
- Import partial failure: show exact successful and remaining counts.

## 9. Verification strategy

### 9.1 Service

- Protocol-normalizer fixture tests for tags, browse, and detail for all five providers.
- Tests that opaque IDs survive round trips unchanged.
- Tests for nullable metadata and mixed play-count inputs.
- Route tests for success envelopes, provider capability checks, validation errors, and upstream failures.
- SSRF regression tests for `http://`, `https://`, scheme-relative, control-character, token-delimiter, and overlong identifiers.
- Per-provider serialization tests proving same-provider calls do not overlap and different-provider calls can overlap.
- OpenAPI path/schema assertions.
- Focused Service build and lint.
- Optional real-upstream integration matrix gated by environment variables; ordinary unit tests remain offline.

### 9.2 Flutter

- Model parsing for capability, tags, browse, detail, nullable metadata, and page metadata.
- Repository request/response contract tests.
- Controller tests for provider defaults, filter reset to page 1, stale-request suppression, page retention after failure, and detail page accumulation.
- Widget tests for desktop expandable categories and mobile bottom-sheet categories.
- Widget tests proving counts/pages are API-derived and the placeholder strings are absent.
- Navigation test from a discovery card to the correct `source/playlistId` detail route.
- Shared track-list tests reused across search and online detail configurations.
- Complete-playlist import tests for multiple provider pages, batch sequencing, cancellation, and partial failure.
- Focused visual fixtures for playlist square and online detail at existing desktop/mobile reference widths.
- Optional real-Service acceptance test covering tags, browse, detail, and at least one playable normalized track per advertised provider.

## 10. Delivery and compatibility

Implementation order is Service contract and tests first, followed by Flutter models/repository, controllers, shared track-list extraction, screens/routes, and integration verification.

The capability field is additive. Older Flutter clients ignore it. The new Flutter client treats a missing discovery capability as unsupported, so it remains safe against an older Service and can present a clear capability-missing state instead of falling back to fake keyword discovery.

No database migration is required. No existing playlist, search, leaderboard, or playback endpoint is removed or behaviorally redefined.

## 11. Completion criteria

The work is complete when:

- all five bundled providers expose only their real native sorts and tag groups;
- the Flutter square contains no fixed `热门` search, fake recommendation label, or hard-coded page count;
- browse counts, pages, playlist metadata, and tracks come from Service responses;
- every discovery card opens its real online detail;
- track rows match the shared search-list implementation;
- single-track and complete-playlist add flows work against Service playlists;
- arbitrary URLs cannot reach provider detail fetch logic;
- focused Service and Flutter tests pass, with any unavailable real-upstream checks reported separately.
