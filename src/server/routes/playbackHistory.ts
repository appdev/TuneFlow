import { Type } from '@fastify/type-provider-typebox'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { IdParams, Identifier, Track } from '../api/schemas/domain'
import type { ApiFastifyInstance } from '../api/types'
import { ApiError } from '../errors'
import {
  PLAYBACK_PLATFORMS,
  type PlaybackHistoryRepository,
  type PlaybackSession,
} from '../playback/historyRepository'

const PlaybackHistoryTrack = Type.Object({
  ...Track.properties,
  source: Identifier,
}, { additionalProperties: true })

const NullableNumber = Type.Union([Type.Number(), Type.Null()])
const PlaybackSessionSchema = Type.Object({
  playbackId: Identifier,
  track: PlaybackHistoryTrack,
  platform: Type.Union(PLAYBACK_PLATFORMS.map(platform => Type.Literal(platform))),
  startedAt: Type.Number(),
  endedAt: NullableNumber,
  completed: Type.Boolean(),
  lastPositionSeconds: NullableNumber,
  durationSeconds: NullableNumber,
}, { additionalProperties: false })

interface PlaybackHistoryRouteOptions {
  history: PlaybackHistoryRepository
  onStarted?: (session: PlaybackSession) => void | Promise<void>
}

export const registerPlaybackHistoryRoutes = (app: ApiFastifyInstance, options: PlaybackHistoryRouteOptions): void => {
  app.get('/api/v1/playback/history', {
    schema: {
      operationId: 'listPlaybackHistory',
      tags: ['Playback'],
      summary: 'List playback sessions from the last 30 days',
      response: { 200: ApiSuccess(Type.Array(PlaybackSessionSchema)), ...ErrorResponses },
    },
  }, async() => ({ data: options.history.list() }))

  app.post('/api/v1/playback/history', {
    schema: {
      operationId: 'startPlaybackHistory',
      tags: ['Playback'],
      summary: 'Record a successfully started playback session',
      body: Type.Object({
        track: PlaybackHistoryTrack,
        platform: Type.Union(PLAYBACK_PLATFORMS.map(platform => Type.Literal(platform))),
      }, { additionalProperties: false }),
      response: { 200: ApiSuccess(PlaybackSessionSchema), ...ErrorResponses },
    },
  }, async(request) => {
    const session = options.history.start(request.body.track, request.body.platform)
    if (options.onStarted != null) {
      void Promise.resolve(options.onStarted(session)).catch(error => {
        app.log.warn({ err: error, playbackId: session.playbackId }, 'Unable to apply playback-start side effects')
      })
    }
    return { data: session }
  })

  app.patch('/api/v1/playback/history/:id', {
    schema: {
      operationId: 'endPlaybackHistory',
      tags: ['Playback'],
      summary: 'End a playback session',
      params: IdParams,
      body: Type.Object({
        completed: Type.Boolean(),
        lastPositionSeconds: Type.Number({ minimum: 0 }),
        durationSeconds: Type.Number({ minimum: 0 }),
      }, { additionalProperties: false }),
      response: { 200: ApiSuccess(PlaybackSessionSchema), ...ErrorResponses },
    },
  }, async(request) => {
    const session = options.history.end(request.params.id, request.body)
    if (session == null) throw new ApiError(404, 'NOT_FOUND', 'Playback session not found')
    return { data: session }
  })
}
