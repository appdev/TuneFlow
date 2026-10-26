import { Type } from '@fastify/type-provider-typebox'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { Identifier, Track } from '../api/schemas/domain'
import type { ApiFastifyInstance } from '../api/types'
import { ApiError } from '../errors'
import type { RecommendationService } from '../recommendations/service'
import type { RecommendationFeedbackInput } from '../recommendations/types'

const Status = Type.Union([
  Type.Literal('warming'),
  Type.Literal('generating'),
  Type.Literal('ready'),
  Type.Literal('degraded'),
  Type.Literal('stale'),
  Type.Literal('disabled'),
])
const NullableNumber = Type.Union([Type.Number(), Type.Null()])
const NullableString = Type.Union([Type.String(), Type.Null()])
const Reason = Type.Object({
  type: Type.Union([
    Type.Literal('playlist_cooccurrence'),
    Type.Literal('artist_affinity'),
    Type.Literal('album_affinity'),
    Type.Literal('tag_affinity'),
    Type.Literal('familiar_replay'),
    Type.Literal('exploration'),
  ]),
  seedTrackName: Type.Optional(Type.String()),
  labels: Type.Array(Type.String()),
}, { additionalProperties: false })
const RecommendationItem = Type.Object({
  recommendationItemId: Identifier,
  canonicalTrackId: Identifier,
  track: Track,
  bucket: Type.Union([Type.Literal('new'), Type.Literal('familiar')]),
  reason: Reason,
  feedback: Type.Object({
    interested: Type.Boolean(),
    interestedFeedbackId: NullableString,
  }, { additionalProperties: false }),
}, { additionalProperties: false })
const DailyResponse = Type.Object({
  status: Status,
  localDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  snapshotLocalDate: NullableString,
  version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  generatedAt: NullableNumber,
  lastErrorCode: NullableString,
  sourceCoverage: Type.Array(Type.String()),
  items: Type.Array(RecommendationItem),
}, { additionalProperties: false })
const FeedbackResponse = Type.Object({ feedbackId: Identifier, active: Type.Boolean(), type: Type.String() }, { additionalProperties: false })

export const registerRecommendationRoutes = (app: ApiFastifyInstance, service: RecommendationService): void => {
  app.get('/api/v1/recommendations/daily', {
    schema: { operationId: 'getDailyRecommendations', tags: ['Recommendations'], summary: 'Get the stable daily recommendation snapshot', response: { 200: ApiSuccess(DailyResponse), ...ErrorResponses } },
  }, async() => ({ data: service.daily() }))

  app.post('/api/v1/recommendations/daily/refresh', {
    schema: {
      operationId: 'refreshDailyRecommendations',
      tags: ['Recommendations'],
      summary: 'Generate a complete replacement for the daily recommendation snapshot',
      response: { 202: ApiSuccess(Type.Object({ generationId: Identifier, status: Type.Literal('generating') }, { additionalProperties: false })), ...ErrorResponses },
    },
  }, async(_request, reply) => {
    try { return reply.code(202).send({ data: service.refresh() }) } catch (error) {
      if (typeof error === 'object' && error != null && 'code' in error && error.code === 'RECOMMENDATION_DISABLED') {
        throw new ApiError(409, 'RECOMMENDATION_DISABLED', 'Recommendations are disabled')
      }
      throw error
    }
  })

  app.get('/api/v1/recommendations/status', {
    schema: {
      operationId: 'getRecommendationStatus',
      tags: ['Recommendations'],
      summary: 'Get recommendation generation status',
      response: {
        200: ApiSuccess(Type.Object({
          status: Status,
          localDate: Type.String(),
          snapshotLocalDate: NullableString,
          version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
          generationId: NullableString,
          generatedAt: NullableNumber,
          sourceCoverage: Type.Array(Type.String()),
          lastErrorCode: NullableString,
        }, { additionalProperties: false })),
        ...ErrorResponses,
      },
    },
  }, async() => ({ data: service.status() }))

  app.post('/api/v1/recommendations/feedback', {
    schema: {
      operationId: 'updateRecommendationFeedback',
      tags: ['Recommendations'],
      summary: 'Record or undo recommendation feedback',
      body: Type.Union([
        Type.Object({ type: Type.Literal('interested_track'), track: Type.Intersect([Track, Type.Object({ source: Identifier })]) }, { additionalProperties: false }),
        Type.Object({ type: Type.Literal('not_interested_track'), track: Type.Intersect([Track, Type.Object({ source: Identifier })]) }, { additionalProperties: false }),
        Type.Object({ type: Type.Literal('not_interested_artist'), artist: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        Type.Object({ type: Type.Literal('undo'), feedbackId: Identifier }, { additionalProperties: false }),
      ]),
      response: { 200: ApiSuccess(FeedbackResponse), ...ErrorResponses },
    },
  }, async(request) => {
    try { return { data: service.recordFeedback(request.body as RecommendationFeedbackInput) } } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_RECOMMENDATION_FEEDBACK') throw new ApiError(400, 'INVALID_RECOMMENDATION_FEEDBACK', 'Recommendation feedback is invalid')
      throw error
    }
  })

  app.post('/api/v1/recommendations/musicbrainz/test', {
    schema: {
      operationId: 'testMusicBrainzConnection',
      tags: ['Recommendations'],
      summary: 'Test a MusicBrainz-compatible Web Service endpoint',
      body: Type.Object({ baseUrl: Type.String() }, { additionalProperties: false }),
      response: {
        200: ApiSuccess(Type.Object({
          ok: Type.Boolean(),
          normalizedBaseUrl: Type.String(),
          errorCode: NullableString,
        }, { additionalProperties: false })),
        ...ErrorResponses,
      },
    },
  }, async(request) => ({ data: await service.testMusicBrainzConnection(request.body.baseUrl) }))

  app.delete('/api/v1/recommendations/profile', {
    schema: {
      operationId: 'clearRecommendationProfile',
      tags: ['Recommendations'],
      summary: 'Clear recommendation profile, feedback, exposure, and snapshots',
      response: { 200: ApiSuccess(Type.Object({ profile: Type.Integer({ minimum: 0 }), feedback: Type.Integer({ minimum: 0 }), exposure: Type.Integer({ minimum: 0 }), snapshots: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })), ...ErrorResponses },
    },
  }, async() => ({ data: service.clearProfile() }))
}
