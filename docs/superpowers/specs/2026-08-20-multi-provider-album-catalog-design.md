# Multi-provider Album Catalog Design

## Objective

Complete TuneFlow's built-in album workflow for `wy`, `kw`, `kg`, `tx`, and
`mg`: album keyword search, capability discovery, album metadata, paged album
tracks, and the existing Flutter client's album-detail screen.

## Scope

- Add album search adapters for Kuwo, Kugou, QQ Music, and Migu.
- Add or expose album detail adapters for all five built-in providers.
- Add `POST /api/v1/catalog/albums/detail` to the Service.
- Advertise `albumDetail` independently from `searchKinds`.
- Preserve the current UserApi contract. User scripts remain playback-resource
  providers and do not gain search actions in this change.
- Do not deploy or mutate the running LAN Service as part of local
  implementation. Deployment remains a separate authorized operation.

## Provider adapters

Each provider exposes two independent capabilities:

```js
{
  albumSearch: { search(text, page, limit) },
  album: { getAlbumDetail(albumId, page) },
}
```

Both methods return the existing renderer-SDK envelopes so that the Service is
the only place that projects them into public DTOs.

### Search sources

- `wy`: keep the existing EAPI cloud search with `type: 10`.
- `kw`: use `search.kuwo.cn/r.s` with `ft=album`, `itemset=web_2013`, and true
  zero-based `pn` pagination.
- `kg`: use `mobilecdn.kugou.com/api/v3/search/album`.
- `tx`: reuse the current signed desktop search request, with
  `search_type: 2`.
- `mg`: reuse the current Migu v3 signature and use a `searchSwitch` that
  enables only `album`.

Search results normalize to:

```ts
{
  list: Array<{
    id: string
    name: string
    author?: string
    total?: number
    img?: string | null
    description?: string
    source: 'wy' | 'kw' | 'kg' | 'tx' | 'mg'
  }>
  total: number
  limit: number
  source: string
}
```

### Detail sources

- `wy`: add an EAPI album-detail adapter and reuse the provider's existing
  track normalization conventions.
- `kw`: expose and harden the existing legacy album module.
- `kg`: expose and harden the existing album-info plus album-song adapter.
- `tx`: add `music.musichallAlbum.AlbumSongList/GetAlbumSongList`, using album
  MID as the identifier and the existing `filterMusicInfoItem` track mapper.
- `mg`: expose and harden the existing album-info plus album-song adapter.

Every detail adapter returns:

```ts
{
  list: unknown[]
  page: number
  limit: number
  total: number
  source: string
  info: {
    name: string
    img?: string | null
    desc?: string | null
    author?: string
    play_count?: string | number
  }
}
```

## Service contract

`catalogCapabilities()` includes `albumDetail: boolean`. Album search remains
derived from `provider.albumSearch.search`; detail support is derived from
`provider.album.getAlbumDetail`. This lets the client disable opening an album
if an upstream detail protocol becomes unavailable without hiding search.

The new endpoint accepts:

```json
{"source":"tx","albumId":"0024bjiL2aocxT","page":1}
```

and returns the existing Flutter `AlbumDetailPage` shape:

```json
{
  "source": "tx",
  "page": 1,
  "limit": 100,
  "total": 12,
  "hasMore": false,
  "album": {
    "id": "0024bjiL2aocxT",
    "kind": "album",
    "name": "十一月的萧邦",
    "source": "tx",
    "author": "周杰伦"
  },
  "tracks": []
}
```

Album identifiers are validated before provider invocation. `wy`, `kw`, `kg`,
and `mg` accept decimal identifiers; `tx` accepts a bounded ASCII alphanumeric
MID. All sources reject URL-like input, control characters, `###`, empty IDs,
and IDs longer than 128 characters.

Provider responses are checked at the Service boundary. Missing album IDs,
missing detail lists, or malformed metadata produce `SOURCE_PROTOCOL_ERROR`.

Provider transport remains an upstream compatibility boundary. Album endpoints
use HTTPS wherever the provider presents a valid certificate. Kugou album
search remains on `http://mobilecdn.kugou.com` because that host does not
present a certificate valid for its hostname; its search metadata must
therefore be treated as untrusted input and is validated before publication.
Unsafe identifiers produce `INVALID_ALBUM_ID` and HTTP 400. Upstream failures
remain sanitized as HTTP 502.

## Verification

- Provider unit tests mock `httpFetch`/signed request boundaries and assert
  exact request parameters plus normalized results.
- TuneFlow SDK tests cover ID validation, detail normalization, pagination, and
  unsupported providers.
- Catalog route tests cover capability output, schema validation, successful
  detail envelopes, and sanitized errors.
- Run a focused TypeScript build and Vitest suites.
- Run the Flutter model/repository/search/album-detail tests against the frozen
  Service contract. No Flutter source changes are expected.
- A local live smoke test may call all five search/detail routes. It must use a
  temporary storage root and a non-production port and must not deploy to
  `192.168.0.172:3124`.
