import { Type } from '@fastify/type-provider-typebox'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors'
import { proxyPlayback, type PlaybackProxyOptions } from '../playback/proxy'
import { PlaybackResolver, type ResolveTrackInput, type ResolvedTrack } from '../playback/resolver'
import { TokenStore } from '../playback/tokenStore'
import type { SourcesService } from './sources'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'

interface PlaybackRouteOptions extends PlaybackProxyOptions {
  tokenStore?: TokenStore
  resolveTrack?: (input: ResolveTrackInput) => Promise<ResolvedTrack>
  sources?: SourcesService
  findLocalTrack?: (musicInfo: unknown) => Promise<string | undefined> | string | undefined
}

export const registerPlaybackRoutes = (app: ApiFastifyInstance, options: PlaybackRouteOptions = {}): void => {
  const store = options.tokenStore ?? new TokenStore()
  const playbackResolver = options.sources == null ? undefined : new PlaybackResolver(options.sources, store, undefined, options.findLocalTrack)
  const resolver = options.resolveTrack ?? playbackResolver?.resolveTrack.bind(playbackResolver)
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
      response: { 200: ApiSuccess(Type.Object({ url: Type.String(), quality: Type.String(), expiresAt: Type.Number() }, { additionalProperties: false })), ...ErrorResponses, 503: ErrorResponses[500] },
    },
  }, async(request) => {
    const input = request.body as Partial<ResolveTrackInput> | null
    if (input == null || typeof input.source !== 'string' || input.source.length === 0 || input.info == null || typeof input.quality !== 'string') throw new ApiError(400, 'SOURCE_PROTOCOL_ERROR', 'Invalid playback resolve request')
    if (resolver == null) throw new ApiError(503, 'PLAYBACK_UNAVAILABLE', 'Playback resolver unavailable')
    return { data: await resolver(input as ResolveTrackInput) }
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
}
