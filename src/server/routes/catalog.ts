import { Type } from '@fastify/type-provider-typebox'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { ApiError } from '../errors'
import { getLyric, getPicture, search } from '../lxSdk'
import type { SourcesService } from './sources'

const TrackInput = Type.Object({
  source: Type.String({ minLength: 1 }),
  musicInfo: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false })

const sourceFailure = (error: unknown, message: string): never => {
  if (error instanceof ApiError) throw error
  const code = typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string' ? error.code : 'SOURCE_PROTOCOL_ERROR'
  throw new ApiError(502, code, message)
}

const activeSourceFor = (sources: SourcesService | undefined, provider: string, action: 'lyric' | 'pic') => sources
  ?.list()
  .find(source => source.active && source.sources?.[provider]?.actions.includes(action))

export const registerCatalogRoutes = (app: ApiFastifyInstance, sources?: SourcesService): void => {
  app.post('/api/v1/catalog/tracks/search', {
    schema: {
      operationId: 'searchCatalogTracks',
      tags: ['Catalog'],
      summary: 'Search tracks from a built-in provider',
      body: Type.Object({ source: Type.String({ minLength: 1 }), text: Type.String(), page: Type.Integer({ minimum: 1 }), pageSize: Type.Integer({ minimum: 1, maximum: 100 }) }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Unknown()), ...ErrorResponses },
    },
  }, async(request) => {
    const { source, text, page, pageSize } = request.body
    try { return { data: await search({ source, text, page, limit: pageSize }) } } catch (error) { return sourceFailure(error, 'Track search failed') }
  })

  app.post('/api/v1/catalog/tracks/lyrics', {
    schema: {
      operationId: 'getCatalogTrackLyrics',
      tags: ['Catalog'],
      summary: 'Get lyrics for a track',
      body: TrackInput,
      response: { 200: ApiSuccess(Type.Unknown()), ...ErrorResponses },
    },
  }, async(request) => {
    try {
      const active = activeSourceFor(sources, request.body.source, 'lyric')
      return {
        data: active == null
          ? await getLyric(request.body.source, request.body.musicInfo)
          : await sources!.requestSource(active.id, { source: request.body.source, action: 'lyric', info: request.body.musicInfo }),
      }
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
      const active = activeSourceFor(sources, request.body.source, 'pic')
      const url = active == null
        ? await getPicture(request.body.source, request.body.musicInfo)
        : await sources!.requestSource<string>(active.id, { source: request.body.source, action: 'pic', info: request.body.musicInfo })
      return { data: { url } }
    } catch (error) { return sourceFailure(error, 'Picture lookup failed') }
  })
}
