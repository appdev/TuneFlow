import { Type } from '@fastify/type-provider-typebox'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { Identifier, Track } from '../api/schemas/domain'
import type { ApiFastifyInstance } from '../api/types'
import type { PlaybackHistoryRepository } from '../playback/historyRepository'

const PlaybackHistoryTrack = Type.Object({
  ...Track.properties,
  source: Identifier,
}, { additionalProperties: true })

const PlaybackHistoryEntry = Type.Object({
  track: PlaybackHistoryTrack,
  playedAt: Type.Number(),
}, { additionalProperties: false })

export const registerPlaybackHistoryRoutes = (app: ApiFastifyInstance, history: PlaybackHistoryRepository): void => {
  app.get('/api/v1/playback/history', {
    schema: {
      operationId: 'listPlaybackHistory',
      tags: ['Playback'],
      summary: 'List recent playback history',
      response: { 200: ApiSuccess(Type.Array(PlaybackHistoryEntry)), ...ErrorResponses },
    },
  }, async() => ({ data: history.list() }))

  app.post('/api/v1/playback/history', {
    schema: {
      operationId: 'recordPlaybackHistory',
      tags: ['Playback'],
      summary: 'Record a successfully started playback',
      body: Type.Object({ track: PlaybackHistoryTrack }, { additionalProperties: false }),
      response: { 200: ApiSuccess(PlaybackHistoryEntry), ...ErrorResponses },
    },
  }, async(request) => ({ data: history.record(request.body.track) }))
}
