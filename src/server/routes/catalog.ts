import { Type } from '@fastify/type-provider-typebox'
import type { IncomingMessage } from 'node:http'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { CatalogCollection, CatalogLyrics, CatalogTrack } from '../api/schemas/domain'
import { ApiError } from '../errors'
import { browsePlaylists, catalogCapabilities, getLeaderboardTracks, getLeaderboards, getLyric, getPicture, getPlaylistDetail, getPlaylistTags, search, searchCollections } from '../tuneFlowSdk'
import type { SourcesService } from './sources'
import { SourceServiceError } from '../sources/types'
import { MediaClient } from '../playback/mediaClient'
import { PlaybackResourceStore } from '../playback/resourceStore'
import { TrackResourceService } from '../resources/trackResources'

const TrackIdentity = Type.Union([
  Type.Object({
    id: Type.Union([Type.String({ minLength: 1 }), Type.Number()]),
  }, { additionalProperties: true }),
  Type.Object({
    songmid: Type.Union([Type.String({ minLength: 1 }), Type.Number()]),
  }, { additionalProperties: true }),
  Type.Object({
    meta: Type.Object({
      songId: Type.Union([Type.String({ minLength: 1 }), Type.Number()]),
    }, { additionalProperties: true }),
  }, { additionalProperties: true }),
])

const TrackInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  musicInfo: TrackIdentity,
}, { additionalProperties: false })

const SearchInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  text: Type.String(),
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
}, { additionalProperties: false })

const LeaderboardInput = Type.Object({
  source: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

const LeaderboardTracksInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  boardId: Type.String({ minLength: 1 }),
  page: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })

const PlaylistSourceInput = Type.Object({
  source: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

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

const searchResult = (item: typeof CatalogTrack | typeof CatalogCollection) => Type.Object({
  list: Type.Array(item),
  total: Type.Number(),
  limit: Type.Number(),
  page: Type.Number(),
  source: Type.String(),
}, { additionalProperties: false })

const CatalogCapabilities = Type.Object({
  sources: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
    searchKinds: Type.Array(Type.Union([Type.Literal('track'), Type.Literal('playlist'), Type.Literal('album')])),
    leaderboards: Type.Boolean(),
    playlistDiscovery: Type.Optional(Type.Object({
      tags: Type.Boolean(),
      browse: Type.Boolean(),
      detail: Type.Boolean(),
    }, { additionalProperties: false })),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const PlaylistTag = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

const PlaylistTagGroup = Type.Object({
  name: Type.String({ minLength: 1 }),
  tags: Type.Array(PlaylistTag),
}, { additionalProperties: false })

const PlaylistFilters = Type.Object({
  source: Type.String({ minLength: 1 }),
  sorts: Type.Array(PlaylistTag),
  hotTags: Type.Array(PlaylistTag),
  groups: Type.Array(PlaylistTagGroup),
}, { additionalProperties: false })

const PlaylistPageFields = {
  source: Type.String({ minLength: 1 }),
  page: Type.Number(),
  limit: Type.Number(),
  total: Type.Union([Type.Number(), Type.Null()]),
  hasMore: Type.Boolean(),
}

const PlaylistBrowsePage = Type.Object({
  ...PlaylistPageFields,
  list: Type.Array(CatalogCollection),
}, { additionalProperties: false })

const PlaylistDetailPage = Type.Object({
  ...PlaylistPageFields,
  playlist: CatalogCollection,
  tracks: Type.Array(CatalogTrack),
}, { additionalProperties: false })

const LeaderboardPage = Type.Object({
  list: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    providerId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1 }),
  }, { additionalProperties: false })),
  source: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

const sourceFailure = (error: unknown, message: string): never => {
  if (error instanceof ApiError) throw error
  const code = typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string' ? error.code : 'SOURCE_PROTOCOL_ERROR'
  if (code === 'INVALID_PLAYLIST_ID') throw new ApiError(400, code, message)
  throw new ApiError(502, code, message)
}

const withRequestAbortSignal = async<T>(
  raw: Pick<IncomingMessage, 'aborted' | 'once' | 'off'>,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  if (raw.aborted) abort()
  else raw.once('aborted', abort)
  try { return await operation(controller.signal) } finally { raw.off('aborted', abort) }
}

export interface CatalogResourceOptions {
  mediaClient?: MediaClient
  resourceStore?: PlaybackResourceStore
  trackResources?: TrackResourceService
  getBuiltinLyrics?: (source: string, musicInfo: unknown) => ReturnType<typeof getLyric>
  getBuiltinPicture?: (source: string, musicInfo: unknown) => ReturnType<typeof getPicture>
}

export const registerCatalogRoutes = (app: ApiFastifyInstance, sources?: SourcesService, resourceOptions: CatalogResourceOptions = {}): void => {
  const mediaClient = resourceOptions.mediaClient ?? new MediaClient()
  const resourceStore = resourceOptions.resourceStore ?? new PlaybackResourceStore()
  const sourceAccess = sources == null
    ? {
        snapshot: () => [],
        requestSource: async() => { throw new SourceServiceError('SOURCE_NOT_FOUND', 'Source not found', 'protocol') },
      }
    : typeof sources.snapshot === 'function'
      ? sources
      : {
          snapshot: (provider: string, action: 'musicUrl' | 'lyric' | 'pic') => {
            const active = sources.list().find(source => source.active && source.sources?.[provider]?.actions.includes(action))
            return active == null ? [] : [{ id: active.id, priority: 0 }]
          },
          requestSource: sources.requestSource.bind(sources),
        }
  const trackResources = resourceOptions.trackResources ?? new TrackResourceService({
    sources: sourceAccess as Pick<SourcesService, 'snapshot' | 'requestSource'>,
    mediaClient,
    getBuiltinLyrics: resourceOptions.getBuiltinLyrics ?? (async(source, musicInfo) => await getLyric(source, musicInfo)),
    getBuiltinPicture: resourceOptions.getBuiltinPicture ?? (async(source, musicInfo) => await getPicture(source, musicInfo)),
  })
  app.get('/api/v1/catalog/capabilities', {
    schema: {
      operationId: 'getCatalogCapabilities',
      tags: ['Catalog'],
      summary: 'List built-in catalog providers and supported search kinds',
      response: { 200: ApiSuccess(CatalogCapabilities) },
    },
  }, async() => ({ data: { sources: catalogCapabilities() } }))

  app.post('/api/v1/catalog/tracks/search', {
    schema: {
      operationId: 'searchCatalogTracks',
      tags: ['Catalog'],
      summary: 'Search tracks from a built-in provider',
      body: SearchInput,
      response: { 200: ApiSuccess(searchResult(CatalogTrack)), ...ErrorResponses },
    },
  }, async(request) => {
    const { source, text, page, pageSize } = request.body
    try { return { data: await search({ source, text, page, limit: pageSize }) } } catch (error) { return sourceFailure(error, 'Track search failed') }
  })

  app.post('/api/v1/catalog/leaderboards', {
    schema: {
      operationId: 'getCatalogLeaderboards',
      tags: ['Catalog'],
      summary: 'List leaderboards from a built-in provider',
      body: LeaderboardInput,
      response: { 200: ApiSuccess(LeaderboardPage), ...ErrorResponses },
    },
  }, async(request) => {
    try { return { data: await getLeaderboards(request.body.source) } } catch (error) { return sourceFailure(error, 'Leaderboard lookup failed') }
  })

  app.post('/api/v1/catalog/leaderboards/tracks', {
    schema: {
      operationId: 'getCatalogLeaderboardTracks',
      tags: ['Catalog'],
      summary: 'List tracks in a built-in provider leaderboard',
      body: LeaderboardTracksInput,
      response: { 200: ApiSuccess(searchResult(CatalogTrack)), ...ErrorResponses },
    },
  }, async(request) => {
    const { source, boardId, page } = request.body
    try { return { data: await getLeaderboardTracks(source, boardId, page) } } catch (error) { return sourceFailure(error, 'Leaderboard track lookup failed') }
  })

  app.post('/api/v1/catalog/playlists/tags', {
    schema: {
      operationId: 'getCatalogPlaylistTags',
      tags: ['Catalog'],
      summary: 'List native playlist tags and sorts from a built-in provider',
      body: PlaylistSourceInput,
      response: { 200: ApiSuccess(PlaylistFilters), ...ErrorResponses },
    },
  }, async(request) => {
    try { return { data: await getPlaylistTags(request.body.source) } } catch (error) { return sourceFailure(error, 'Playlist tags lookup failed') }
  })

  app.post('/api/v1/catalog/playlists/browse', {
    schema: {
      operationId: 'browseCatalogPlaylists',
      tags: ['Catalog'],
      summary: 'Browse native playlists from a built-in provider',
      body: PlaylistBrowseInput,
      response: { 200: ApiSuccess(PlaylistBrowsePage), ...ErrorResponses },
    },
  }, async(request) => {
    try { return { data: await browsePlaylists(request.body) } } catch (error) { return sourceFailure(error, 'Playlist browse failed') }
  })

  app.post('/api/v1/catalog/playlists/detail', {
    schema: {
      operationId: 'getCatalogPlaylistDetail',
      tags: ['Catalog'],
      summary: 'Get a native playlist and its tracks from a built-in provider',
      body: PlaylistDetailInput,
      response: { 200: ApiSuccess(PlaylistDetailPage), ...ErrorResponses },
    },
  }, async(request) => {
    try { return { data: await getPlaylistDetail(request.body) } } catch (error) { return sourceFailure(error, 'Playlist detail lookup failed') }
  })

  for (const kind of ['playlists', 'albums'] as const) {
    const singular = kind === 'playlists' ? 'playlist' : 'album'
    app.post(`/api/v1/catalog/${kind}/search`, {
      schema: {
        operationId: kind === 'playlists' ? 'searchCatalogPlaylists' : 'searchCatalogAlbums',
        tags: ['Catalog'],
        summary: `Search ${kind} from a built-in provider`,
        body: SearchInput,
        response: { 200: ApiSuccess(searchResult(CatalogCollection)), ...ErrorResponses },
      },
    }, async(request) => {
      const { source, text, page, pageSize } = request.body
      try { return { data: await searchCollections(singular, { source, text, page, limit: pageSize }) } } catch (error) { return sourceFailure(error, `${singular} search failed`) }
    })
  }

  app.post('/api/v1/catalog/tracks/lyrics', {
    schema: {
      operationId: 'getCatalogTrackLyrics',
      tags: ['Catalog'],
      summary: 'Get lyrics for a track',
      body: TrackInput,
      response: { 200: ApiSuccess(CatalogLyrics), ...ErrorResponses },
    },
  }, async(request) => {
    try {
      return { data: await withRequestAbortSignal(request.raw, async signal => await trackResources.resolveLyrics(request.body.source, request.body.musicInfo, signal)) }
    } catch (error) { return sourceFailure(error, 'Lyric lookup failed') }
  })

  app.post('/api/v1/catalog/tracks/picture', {
    schema: {
      operationId: 'getCatalogTrackPicture',
      tags: ['Catalog'],
      summary: 'Get a picture URL for a track',
      body: TrackInput,
      response: { 200: ApiSuccess(Type.Object({ url: Type.String({ minLength: 1 }) }, { additionalProperties: false })), ...ErrorResponses },
    },
  }, async(request) => {
    try {
      const picture = await withRequestAbortSignal(request.raw, async signal => await trackResources.resolvePicture(request.body.source, request.body.musicInfo, signal))
      const stored = resourceStore.putPicture(picture)
      return { data: { url: `/api/v1/playback/resources/${stored.token}/picture` } }
    } catch (error) { return sourceFailure(error, 'Picture lookup failed') }
  })
}
