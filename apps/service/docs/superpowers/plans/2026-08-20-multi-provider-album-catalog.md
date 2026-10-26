# Multi-provider Album Catalog Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete album search and album-detail support for TuneFlow's five built-in music providers so the Flutter client can switch sources and open every returned album.

**Architecture:** Provider-local adapters speak each platform's native protocol and return the renderer SDK's existing collection/detail envelopes. `src/server/tuneFlowSdk/index.ts` validates identifiers and normalizes every provider into one public catalog contract; Fastify exposes that contract and capability flags. The UserApi plugin protocol is unchanged.

**Tech Stack:** JavaScript provider adapters, TypeScript/Fastify/TypeBox Service, Vitest, Flutter/Dart contract tests.

## Global Constraints

- Supported built-in providers are exactly `wy`, `kw`, `kg`, `tx`, and `mg`.
- Do not add dependencies or extend `SourceAction`/UserApi actions.
- Do not deploy to or modify `192.168.0.172:3124` during implementation.
- Preserve the unrelated untracked Service document and the Flutter client's existing dirty worktree.
- Do not commit without explicit user authorization.
- Public album detail route: `POST /api/v1/catalog/albums/detail`.
- Unsafe album IDs return `INVALID_ALBUM_ID`; malformed upstream payloads return `SOURCE_PROTOCOL_ERROR`.

---

### Task 1: Kuwo album search and detail provider

**Files:**
- Create: `src/renderer/utils/musicSdk/kw/albumSearch.js`
- Create: `src/renderer/utils/musicSdk/kw/albumSearch.test.ts`
- Create: `src/renderer/utils/musicSdk/kw/album.test.ts`
- Modify: `src/renderer/utils/musicSdk/kw/album.js`
- Modify: `src/renderer/utils/musicSdk/kw/index.js`

**Interfaces:**
- Produces: `kw.albumSearch.search(text, page, limit)` and `kw.album.getAlbumDetail(albumId, page)`.
- Detail output follows `{ list, page, limit, total, source: 'kw', info }`.

- [x] **Step 1: Write failing search tests**

Mock `../../request` and assert the request includes the collection-search
parameters that were live-verified:

```ts
expect(httpFetch).toHaveBeenCalledWith(expect.stringContaining('ft=album'))
expect(httpFetch).toHaveBeenCalledWith(expect.stringContaining('itemset=web_2013'))
expect(httpFetch).toHaveBeenCalledWith(expect.stringContaining('pn=1'))
expect(result).toMatchObject({
  source: 'kw', total: 2, limit: 20,
  list: [{ id: '87758985', name: '太阳之子', author: '周杰伦', total: 13 }],
})
```

Use a response containing `albumlist`, `TOTAL`, HTML entities, `hts_img`,
`musiccnt`, and `info`; assert entities and legacy line escapes are decoded.

- [x] **Step 2: Run the Kuwo tests and verify the new test fails**

Run:

```bash
npx vitest run src/renderer/utils/musicSdk/kw/albumSearch.test.ts
```

Expected: FAIL because `albumSearch.js` does not exist.

- [x] **Step 3: Implement the Kuwo search adapter and register both capabilities**

Implement `search()` with `httpFetch`, `objStr2JSON`, `decodeName`, and
`formatSinger`. Use `pn=${page - 1}`, `rn=${limit}`, `ft=album`,
`itemset=web_2013`, `client=kt`, `pcmp4=1`, `geo=c`, `vipver=1`,
`rformat=json`, and `encoding=utf8`. Map `albumid || id`, `name`,
`aartist || artist`, `musiccnt`, `hts_img || img`, and `info`. Throw an error
when the response does not contain an array.

Add to `kw/index.js`:

```js
import albumSearch from './albumSearch'
import album from './album'
```

Expose both names as properties on the existing `kw` object without changing
the order or behavior of its current capabilities.

- [x] **Step 4: Characterize and harden the existing Kuwo detail adapter**

In `album.test.ts`, mock a legacy `stype=albuminfo` response and assert page 2
uses `pn=1`, tracks retain `songmid`, `albumId`, source, and quality maps, and
metadata includes name/image/description/author. Update `album.js` only where
the test exposes concrete response-shape problems; export the stable method as
`getAlbumDetail` while retaining `getAlbumListDetail` as a compatibility alias.

- [x] **Step 5: Run focused Kuwo tests**

```bash
npx vitest run src/renderer/utils/musicSdk/kw/albumSearch.test.ts src/renderer/utils/musicSdk/kw/album.test.ts
```

Expected: PASS.

### Task 2: Kugou album search and detail provider

**Files:**
- Create: `src/renderer/utils/musicSdk/kg/albumSearch.js`
- Create: `src/renderer/utils/musicSdk/kg/albumSearch.test.ts`
- Create: `src/renderer/utils/musicSdk/kg/album.test.ts`
- Modify: `src/renderer/utils/musicSdk/kg/album.js`
- Modify: `src/renderer/utils/musicSdk/kg/index.js`

**Interfaces:**
- Produces: `kg.albumSearch.search(text, page, limit)` and `kg.album.getAlbumDetail(albumId, page)`.

- [x] **Step 1: Write failing Kugou search tests**

Mock this native response:

```ts
{
  status: 1,
  errcode: 0,
  data: {
    total: 500,
    info: [{
      albumid: 960399,
      albumname: '魔杰座',
      singername: '周杰伦',
      songcount: 11,
      imgurl: 'http://imge.kugou.com/stdmusic/{size}/fixture.jpg',
      intro: 'Fixture',
    }],
  },
}
```

Assert the adapter requests `/api/v3/search/album`, preserves page/page size,
replaces `{size}` with `400`, stringifies the ID, and returns the common search
envelope.

- [x] **Step 2: Verify the Kugou search test fails**

```bash
npx vitest run src/renderer/utils/musicSdk/kg/albumSearch.test.ts
```

Expected: FAIL because the module is absent.

- [x] **Step 3: Implement and register Kugou album capabilities**

Use `http://mobilecdn.kugou.com/api/v3/search/album` with `format=json`,
`keyword`, `page`, and `pagesize`. Treat `status !== 1`, `errcode !== 0`, or a
non-array `data.info` as an upstream error. Register `albumSearch` and the
existing `album` object in `kg/index.js`.

- [x] **Step 4: Test and harden Kugou detail paging**

Mock `createHttpFetch` for both `api/v3/album/song` and `container/v1/album`,
and mock `getMusicInfosByList`. Assert the requested page is preserved, album
metadata maps into `info`, and the result includes the upstream total. Reject
missing `info`, missing album metadata, or a non-array music-info result.

- [x] **Step 5: Run focused Kugou tests**

```bash
npx vitest run src/renderer/utils/musicSdk/kg/albumSearch.test.ts src/renderer/utils/musicSdk/kg/album.test.ts
```

Expected: PASS.

### Task 3: QQ Music album search and detail provider

**Files:**
- Create: `src/renderer/utils/musicSdk/tx/albumSearch.js`
- Create: `src/renderer/utils/musicSdk/tx/albumSearch.test.ts`
- Create: `src/renderer/utils/musicSdk/tx/album.js`
- Create: `src/renderer/utils/musicSdk/tx/album.test.ts`
- Modify: `src/renderer/utils/musicSdk/tx/index.js`

**Interfaces:**
- Consumes: `signRequest(data)` and exported `filterMusicInfoItem(item)`.
- Produces: `tx.albumSearch.search(text, page, limit)` and `tx.album.getAlbumDetail(albumMid, page)`.

- [x] **Step 1: Write failing signed-search tests**

Mock `signRequest` and return `body.album.list` entries with `albumMID`,
`albumName`, `albumPic`, `singerName`, and `song_count`. Assert the request uses:

```ts
expect(signRequest).toHaveBeenCalledWith(expect.objectContaining({
  'music.search.SearchCgiService': expect.objectContaining({
    method: 'DoSearchForQQMusicDesktop',
    param: expect.objectContaining({
      query: '周杰伦', search_type: 2, page_num: 2, num_per_page: 20,
    }),
  }),
}))
```

Assert `meta.sum` becomes total and `albumMID` is the public ID.

- [x] **Step 2: Verify QQ search tests fail, then implement the adapter**

```bash
npx vitest run src/renderer/utils/musicSdk/tx/albumSearch.test.ts
```

Expected before implementation: FAIL. Reuse the exact `comm`, search ID, retry,
and signed-envelope checks from `musicSearch.js`, changing only
`remoteplace` and `search_type: 2`. Do not create a second signing algorithm.

- [x] **Step 3: Write failing QQ album-detail tests**

Mock `httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', ...)` and return:

```ts
{
  code: 0,
  albumSonglist: {
    code: 0,
    data: {
      albumMid: '0024bjiL2aocxT',
      albumName: '十一月的萧邦',
      singerName: '周杰伦',
      totalNum: 12,
      songList: [{ songInfo: fixtureTrack }],
    },
  },
}
```

Assert page 2 requests `begin: 100`, `num: 100`, `order: 2`, and maps
`songInfo` through `filterMusicInfoItem`. The album cover is derived from the
album MID if the response omits a picture.

- [x] **Step 4: Implement QQ detail and register both capabilities**

Use module `music.musichallAlbum.AlbumSongList`, method `GetAlbumSongList`, and
the existing unsigned `musicu.fcg` request style used by singer/playlist
details. Reject non-zero codes or missing `songList`. Register `albumSearch`
and `album` in `tx/index.js`.

- [x] **Step 5: Run focused QQ tests**

```bash
npx vitest run src/renderer/utils/musicSdk/tx/albumSearch.test.ts src/renderer/utils/musicSdk/tx/album.test.ts src/renderer/utils/musicSdk/tx/musicSearch.test.ts src/renderer/utils/musicSdk/tx/songList.test.ts
```

Expected: PASS, including existing protocol regressions.

### Task 4: Migu album search and detail provider

**Files:**
- Create: `src/renderer/utils/musicSdk/mg/albumSearch.js`
- Create: `src/renderer/utils/musicSdk/mg/albumSearch.test.ts`
- Create: `src/renderer/utils/musicSdk/mg/album.test.ts`
- Modify: `src/renderer/utils/musicSdk/mg/album.js`
- Modify: `src/renderer/utils/musicSdk/mg/index.js`

**Interfaces:**
- Consumes: `createSignature(time, text)` from `mg/musicSearch.js` and existing Migu request/music-info utilities.
- Produces: `mg.albumSearch.search(text, page, limit)` and `mg.album.getAlbumDetail(albumId, page)`.

- [x] **Step 1: Write failing Migu search tests**

Mock `httpFetch` and return `code: '000000'` plus:

```ts
albumResultData: {
  totalCount: '41',
  result: [{
    id: '600927015009000944',
    name: '最伟大的作品',
    singer: '周杰伦',
    desc: '2022-07-15',
    imgItems: [{ img: 'https://example.test/album.jpg' }],
  }],
}
```

Assert the URL's decoded `searchSwitch` has `album: 1` and `song: 0`, and the
headers contain values produced by `createSignature`.

- [x] **Step 2: Verify the Migu search test fails, then implement it**

```bash
npx vitest run src/renderer/utils/musicSdk/mg/albumSearch.test.ts
```

Expected before implementation: FAIL. Share the signature helper; do not copy
the fixed signature constants. Reject non-success codes and malformed result
arrays.

- [x] **Step 3: Characterize and harden Migu detail**

Mock the current `/MIGUM3.0/resource/album/song/v2.0` song endpoint and
`/resource/album/v2.0` metadata endpoint. Also cover digital-album search IDs:
resolve them through `resourceinfo.do?resourceType=5`, read `materialId`, then
query the corresponding normal album. Assert page is carried through,
`totalCount` determines total, and missing image, summary, or play-count fields
remain optional rather than throwing. Missing `songList`, metadata, or a
digital-to-material mapping must reject.

- [x] **Step 4: Register Migu album capabilities and run tests**

```bash
npx vitest run src/renderer/utils/musicSdk/mg/albumSearch.test.ts src/renderer/utils/musicSdk/mg/album.test.ts
```

Expected: PASS.

### Task 5: NetEase album detail provider

**Files:**
- Create: `src/renderer/utils/musicSdk/wy/album.js`
- Create: `src/renderer/utils/musicSdk/wy/album.test.ts`
- Create: `src/renderer/utils/musicSdk/wy/albumSearch.test.ts`
- Modify: `src/renderer/utils/musicSdk/wy/index.js`

**Interfaces:**
- Consumes: `eapiRequest`, `formatPlayTime`, `sizeFormate`, and `formatSingerName`.
- Produces: `wy.album.getAlbumDetail(albumId, page)`.

- [x] **Step 1: Characterize existing NetEase search and write failing detail tests**

Add `albumSearch.test.ts` to lock the existing EAPI request to `type: 10`, true
offset pagination, `albumCount`, and the normalized collection fields.

Mock the EAPI response with `code: 200`, `album`, `songs`, and song privileges.
Assert the first page returns album name, artists, `picUrl`, description,
album size, normalized tracks, and source `wy`. Assert a page beyond the one
upstream full list is sliced deterministically using a local limit of 100.

- [x] **Step 2: Verify the test fails**

```bash
npx vitest run src/renderer/utils/musicSdk/wy/album.test.ts
```

Expected: FAIL because `wy/album.js` does not exist.

- [x] **Step 3: Implement and register NetEase album detail**

Call the current EAPI album endpoint using the numeric album ID. Normalize
tracks by importing the existing `wy/singer.js` object and calling its
`filterSongList(songs)` mapper, then slice the normalized list for the requested
100-item page. Register `album` beside the existing `albumSearch`.

- [x] **Step 4: Run NetEase regression tests**

```bash
npx vitest run src/renderer/utils/musicSdk/wy/album.test.ts src/renderer/utils/musicSdk/wy/albumSearch.test.ts src/server/tuneFlowSdk/index.test.ts
```

Expected: PASS.

### Task 6: Service album-detail contract and capability flags

**Files:**
- Modify: `src/server/sources/types.ts`
- Modify: `src/server/tuneFlowSdk/index.ts`
- Modify: `src/server/tuneFlowSdk/index.test.ts`
- Modify: `src/server/routes/catalog.ts`
- Modify: `src/server/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `provider.album.getAlbumDetail(albumId, page)` from Tasks 1–5.
- Produces: `validateAlbumId`, `getAlbumDetail`, `AlbumDetailResult`,
  `ProviderSummary.albumDetail`, and `POST /api/v1/catalog/albums/detail`.

- [x] **Step 1: Add failing SDK tests for validation and normalization**

Extend imports with `getAlbumDetail` and `validateAlbumId`. Cover accepted IDs:

```ts
it.each([
  ['wy', '32311'], ['kw', '87758985'], ['kg', '960399'],
  ['tx', '0024bjiL2aocxT'], ['mg', '600927015009000944'],
])('accepts a native %s album id', (source, id) => {
  expect(validateAlbumId(source, id)).toBe(id)
})
```

Reject URL-like values, controls, `###`, empty values, overly long values,
letters for numeric providers, and punctuation for TX before adapter access.
Mock a provider detail result and assert `getAlbumDetail` returns `kind:
'album'`, normalized track IDs/intervals, paging, and optional metadata.

- [x] **Step 2: Run SDK tests and verify failure**

```bash
npx vitest run src/server/tuneFlowSdk/index.test.ts
```

Expected: FAIL because album detail functions/types do not exist.

- [x] **Step 3: Implement the typed SDK boundary**

Add provider shape:

```ts
album?: { getAlbumDetail: (albumId: string, page: number) => Promise<unknown> }
```

Add `albumDetail: provider?.album?.getAlbumDetail != null` to every capability
summary. Implement bounded source-specific ID patterns and a
`getAlbumDetail({ source, albumId, page })` function that:

1. validates the ID;
2. rejects absent adapters with `SOURCE_CAPABILITY_UNAVAILABLE`;
3. requires an object result, array `list`, and object `info`;
4. normalizes tracks through `SourceWorkerHost.normalizeSearchResult`;
5. maps `info` through the collection normalizer with `kind: 'album'`;
6. returns `source`, page info, `album`, and `tracks`.

- [x] **Step 4: Add failing Fastify route tests**

Update the capability test to require album search and `albumDetail: true` for
all five providers. Add a successful detail request test, a schema rejection
for page 0/extra fields, an `INVALID_ALBUM_ID` HTTP 400 test, and a malformed
provider HTTP 502 test.

- [x] **Step 5: Implement route schemas and handler**

Add:

```ts
const AlbumDetailInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  albumId: Type.String({ minLength: 1, maxLength: 128 }),
  page: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
```

Add `albumDetail: Type.Boolean()` to `CatalogCapabilities`; define an
`AlbumDetailPage` schema using the shared paging fields, `album:
CatalogCollection`, and `tracks: Type.Array(CatalogTrack)`. Map
`INVALID_ALBUM_ID` to HTTP 400 in `sourceFailure`. Register the route before
track resources.

- [x] **Step 6: Run Service contract tests**

```bash
npx vitest run src/server/tuneFlowSdk/index.test.ts src/server/routes/catalog.test.ts
```

Expected: PASS.

### Task 7: Frozen-contract verification and local smoke test

**Files:**
- Verify only: Service files changed in Tasks 1–6
- Verify only: `/Volumes/ext/MusicFree/flutter-client/lib/api/models.dart`
- Verify only: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_repository.dart`
- Verify only: Flutter contract/controller tests listed below

**Interfaces:**
- Consumes: final Service JSON contract.
- Produces: verification evidence; no deployment and no Flutter writes.

- [x] **Step 1: Lint the changed Service files**

Run `git diff --name-only --diff-filter=ACM` and pass only changed `.js`/`.ts`
files under `src/` to ESLint. Expected: exit 0 with no errors.

- [x] **Step 2: Run all focused provider and Service tests once on the frozen tree**

```bash
npx vitest run \
  src/renderer/utils/musicSdk/kw/albumSearch.test.ts \
  src/renderer/utils/musicSdk/kw/album.test.ts \
  src/renderer/utils/musicSdk/kg/albumSearch.test.ts \
  src/renderer/utils/musicSdk/kg/album.test.ts \
  src/renderer/utils/musicSdk/tx/albumSearch.test.ts \
  src/renderer/utils/musicSdk/tx/album.test.ts \
  src/renderer/utils/musicSdk/tx/musicSearch.test.ts \
  src/renderer/utils/musicSdk/tx/songList.test.ts \
  src/renderer/utils/musicSdk/mg/albumSearch.test.ts \
  src/renderer/utils/musicSdk/mg/album.test.ts \
  src/renderer/utils/musicSdk/wy/albumSearch.test.ts \
  src/renderer/utils/musicSdk/wy/album.test.ts \
  src/server/tuneFlowSdk/index.test.ts \
  src/server/routes/catalog.test.ts
```

Expected: all tests PASS.

- [x] **Step 3: Build the Service bundle**

```bash
npm run build:server
```

Expected: exit 0 and regenerate `dist/server/index.cjs` without TypeScript or
bundling errors. Do not treat generated `dist` output as source changes unless
it is tracked by the repository.

- [x] **Step 4: Run Flutter contract regressions without editing Flutter**

From `/Volumes/ext/MusicFree/flutter-client`:

```bash
flutter test \
  test/api/models_test.dart \
  test/features/repositories_test.dart \
  test/features/search/search_controller_test.dart \
  test/features/search/search_screen_test.dart \
  test/features/discovery/album_detail_controller_test.dart \
  test/features/discovery/album_detail_screen_test.dart
```

Expected: PASS. If unrelated dirty-worktree tests fail, isolate and report the
pre-existing failure rather than changing unrelated Flutter files.

- [x] **Step 5: Run a non-production local API smoke test**

Create a temporary directory with `mktemp -d`, choose an unused port, start the
built Service with explicit `TUNEFLOW_STORAGE_ROOT` and `TUNEFLOW_PORT`, then
call `/api/v1/catalog/capabilities`, all five `/albums/search` sources, and one
`/albums/detail` result per source. Assert every advertised provider returns a
non-empty list and every opened album returns a consistent source, album ID,
and track list. Stop the process and retain no temporary runtime state.

- [x] **Step 6: Review the final diff and report residual upstream risk**

Confirm the diff contains only the approved Service adapters, tests, contract,
and task documents. Report that the platform protocols are private upstream
interfaces and can change independently; provider tests protect response
mapping, while the local live smoke test proves their current behavior.
