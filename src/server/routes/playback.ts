import { Type } from '@fastify/type-provider-typebox'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors'
import { proxyPlayback, type PlaybackProxyOptions } from '../playback/proxy'
import { PlaybackResolver, type ResolveTrackInput, type ResolvedTrack } from '../playback/resolver'
import { TokenStore } from '../playback/tokenStore'
import type { SourcesService } from './sources'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { PlaybackResourceStore } from '../playback/resourceStore'
import type { PlaybackBundleResolver } from '../playback/bundleResolver'
import { SourceServiceError } from '../sources/types'

interface PlaybackRouteOptions extends PlaybackProxyOptions {
  tokenStore?: TokenStore
  resolveTrack?: (input: ResolveTrackInput) => Promise<ResolvedTrack>
  sources?: SourcesService
  findLocalTrack?: (musicInfo: unknown) => Promise<string | undefined> | string | undefined
  resourceStore?: PlaybackResourceStore
  bundleResolver?: PlaybackBundleResolver
}

export const registerPlaybackRoutes = (app: ApiFastifyInstance, options: PlaybackRouteOptions = {}): void => {
  const store = options.tokenStore ?? new TokenStore()
  const resourceStore = options.resourceStore ?? new PlaybackResourceStore()
  const playbackResolver = options.sources == null ? undefined : new PlaybackResolver(options.sources, store, undefined, options.findLocalTrack, options.bundleResolver)
  const resolver = options.resolveTrack ?? playbackResolver?.resolveTrack.bind(playbackResolver)
  const Lyrics = Type.Object({
    lyric: Type.String(),
    tlyric: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    rlyric: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    verbatimLyric: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }, { additionalProperties: false })
  const PlaybackResources = Type.Object({
    lyrics: Type.Optional(Lyrics),
    lyricsUrl: Type.Optional(Type.String()),
    pictureUrl: Type.Optional(Type.String()),
  }, { additionalProperties: false })
  app.post('/api/v1/playback/tracks/resolve', {
    schema: {
      operationId: 'resolvePlaybackTrack',
      tags: ['Playback'],
      summary: 'Resolve a track to an opaque stream URL',
      body: Type.Object({
        source: Type.String({ minLength: 1 }),
        info: Type.Unknown(),
        quality: Type.String({ minLength: 1 }),
        preferLocal: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false }),
      response: {
        200: ApiSuccess(Type.Object({
          url: Type.String(),
          quality: Type.String(),
          expiresAt: Type.Number(),
          resources: Type.Optional(PlaybackResources),
          completeness: Type.Optional(Type.Union([Type.Literal('complete'), Type.Literal('mixed'), Type.Literal('audio-only')])),
        }, { additionalProperties: false })),
        ...ErrorResponses,
        503: ErrorResponses[500],
      },
    },
  }, async(request) => {
    const input = request.body as Partial<ResolveTrackInput> | null
    if (input == null || typeof input.source !== 'string' || input.source.length === 0 || input.info == null || typeof input.quality !== 'string') throw new ApiError(400, 'SOURCE_PROTOCOL_ERROR', 'Invalid playback resolve request')
    if (resolver == null) throw new ApiError(503, 'PLAYBACK_UNAVAILABLE', 'Playback resolver unavailable')
    try {
      return { data: await resolver(input as ResolveTrackInput) }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof SourceServiceError) throw new ApiError(502, error.code, 'Playback source request failed')
      throw error
    }
  })
  const streamSchema = {
    tags: ['Playback'],
    summary: 'Stream a resolved track',
    params: Type.Object({ token: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  }
  const stream = async(request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as { token: string }).token
    const entry = store.get(token)
    if (entry == null) throw new ApiError(410, 'PLAYBACK_TOKEN_EXPIRED', 'Playback token expired')
    await proxyPlayback(request, reply, entry, options)
  }
  app.get('/api/v1/streams/:token', { exposeHeadRoute: false, schema: { ...streamSchema, operationId: 'streamPlaybackTrack' } }, stream)
  app.head('/api/v1/streams/:token', { schema: { ...streamSchema, operationId: 'headPlaybackTrack' } }, stream)
  const pictureSchema = {
    tags: ['Playback'],
    summary: 'Read an opaque playback artwork resource',
    params: Type.Object({ token: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    response: {
      200: Type.String({ format: 'binary', contentMediaType: 'application/octet-stream' }),
      ...ErrorResponses,
    },
  }
  const picture = async(request: FastifyRequest, reply: FastifyReply) => {
    const value = resourceStore.getPicture((request.params as { token: string }).token)
    if (value == null) throw new ApiError(410, 'PLAYBACK_RESOURCE_EXPIRED', 'Playback resource expired')
    void reply.header('content-type', value.mimeType).header('content-length', value.bytes.byteLength).header('cache-control', 'private, max-age=300')
    if (request.method === 'HEAD') return await reply.send()
    return await reply.send(Buffer.from(value.bytes))
  }
  app.get('/api/v1/playback/resources/:token/picture', { exposeHeadRoute: false, schema: { ...pictureSchema, operationId: 'getPlaybackPictureResource' } }, picture)
  app.head('/api/v1/playback/resources/:token/picture', { schema: { ...pictureSchema, operationId: 'headPlaybackPictureResource' } }, picture)
}
