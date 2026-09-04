import { Type } from '@fastify/type-provider-typebox'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { Identifier, Track } from '../api/schemas/domain'
import type { ApiFastifyInstance } from '../api/types'
import { ApiError } from '../errors'
import { radioPolicy } from '../radio/policy'
import type { RadioService } from '../radio/service'
import type { RadioBatchRequest, RadioMode } from '../radio/types'

const NullableString = Type.Union([Type.String(), Type.Null()])
const RadioTrack = Type.Intersect([Track, Type.Object({ source: Identifier, name: Type.String(), singer: Type.String() })])
const Reason = Type.Object({
  type: Type.Union([
    Type.Literal('playlist_cooccurrence'), Type.Literal('artist_affinity'), Type.Literal('album_affinity'),
    Type.Literal('tag_affinity'), Type.Literal('familiar_replay'), Type.Literal('exploration'),
  ]),
  seedTrackName: Type.Optional(Type.String()),
  labels: Type.Array(Type.String()),
}, { additionalProperties: false })
const RadioItem = Type.Object({
  recommendationItemId: Identifier,
  radioSessionId: Identifier,
  canonicalTrackId: Identifier,
  track: RadioTrack,
  bucket: Type.Union([Type.Literal('new'), Type.Literal('familiar')]),
  reason: Reason,
  feedback: Type.Object({ interested: Type.Boolean(), interestedFeedbackId: NullableString }, { additionalProperties: false }),
  rankingSource: Type.Union([
    Type.Literal('ai'), Type.Literal('ai_profile_local_rank'), Type.Literal('local'),
    Type.Literal('daily_fallback'), Type.Literal('familiar_fallback'),
  ]),
}, { additionalProperties: false })
const RadioResponse = Type.Object({
  sessionId: Identifier,
  mode: Type.Union([Type.Literal('dedicated'), Type.Literal('queue_continuation')]),
  status: Type.Union([Type.Literal('active'), Type.Literal('degraded')]),
  aiStatus: Type.Union([Type.Literal('enhanced'), Type.Literal('profile_only'), Type.Literal('local'), Type.Literal('disabled'), Type.Literal('unavailable')]),
  profileId: NullableString,
  items: Type.Array(RadioItem, { maxItems: radioPolicy.batchSize }),
}, { additionalProperties: false })
const BatchFields = {
  requestId: Type.String({ minLength: 1, maxLength: 100 }),
  queueGeneration: Type.Integer({ minimum: 0 }),
  currentTrack: Type.Union([RadioTrack, Type.Null()]),
  queuedTracks: Type.Array(RadioTrack, { maxItems: 100 }),
  limit: Type.Integer({ minimum: 1, maximum: radioPolicy.batchSize }),
}
const BatchBody = Type.Object(BatchFields, { additionalProperties: false })
const CreateBody = Type.Object({
  mode: Type.Union([Type.Literal('dedicated'), Type.Literal('queue_continuation')]),
  ...BatchFields,
}, { additionalProperties: false })
const SessionParams = Type.Object({ sessionId: Identifier }, { additionalProperties: false })
const AIStatus = Type.Object({
  enabled: Type.Boolean(),
  configured: Type.Boolean(),
  healthy: Type.Boolean(),
  profileId: NullableString,
  profileSource: Type.Union([Type.Literal('fresh'), Type.Literal('generated'), Type.Literal('stale'), Type.Literal('local')]),
  generatedAt: Type.Union([Type.Number(), Type.Null()]),
  lastErrorCode: NullableString,
}, { additionalProperties: false })

const radioError = (error: unknown): never => {
  const code = typeof error === 'object' && error != null && 'code' in error ? error.code : null
  if (code === 'RADIO_SESSION_NOT_ACTIVE') throw new ApiError(404, 'RADIO_SESSION_NOT_ACTIVE', 'Radio session is not active')
  if (code === 'RADIO_REQUEST_CONFLICT') throw new ApiError(409, 'RADIO_REQUEST_CONFLICT', 'The request ID was reused with a different queue state')
  throw error
}

export const registerRadioRoutes = (app: ApiFastifyInstance, service: RadioService): void => {
  app.post('/api/v1/radio/sessions', {
    schema: { operationId: 'createRadioSession', tags: ['Radio'], summary: 'Create a radio session and return its first batch', body: CreateBody, response: { 200: ApiSuccess(RadioResponse), ...ErrorResponses } },
  }, async(request) => {
    const { mode, ...batch } = request.body
    try { return { data: await service.create(mode as RadioMode, batch as RadioBatchRequest) } } catch (error) { return radioError(error) }
  })

  app.post('/api/v1/radio/sessions/:sessionId/next', {
    schema: { operationId: 'getNextRadioBatch', tags: ['Radio'], summary: 'Get the next idempotent radio batch', params: SessionParams, body: BatchBody, response: { 200: ApiSuccess(RadioResponse), ...ErrorResponses } },
  }, async(request) => {
    try { return { data: await service.next(request.params.sessionId, request.body as RadioBatchRequest) } } catch (error) { return radioError(error) }
  })

  app.get('/api/v1/radio/sessions/:sessionId', {
    schema: { operationId: 'getRadioSession', tags: ['Radio'], summary: 'Get the current radio session batch', params: SessionParams, response: { 200: ApiSuccess(RadioResponse), ...ErrorResponses } },
  }, async(request) => {
    try { return { data: service.get(request.params.sessionId) } } catch (error) { return radioError(error) }
  })

  app.delete('/api/v1/radio/sessions/:sessionId', {
    schema: { operationId: 'closeRadioSession', tags: ['Radio'], summary: 'Close a radio session', params: SessionParams, response: { 200: ApiSuccess(Type.Object({ closed: Type.Literal(true) }, { additionalProperties: false })), ...ErrorResponses } },
  }, async(request) => {
    try { service.close(request.params.sessionId); return { data: { closed: true as const } } } catch (error) { return radioError(error) }
  })

  app.get('/api/v1/recommendations/ai/status', {
    schema: { operationId: 'getRecommendationAIStatus', tags: ['Recommendations'], summary: 'Get recommendation AI health and profile status', response: { 200: ApiSuccess(AIStatus), ...ErrorResponses } },
  }, async() => ({ data: service.status() }))

  app.post('/api/v1/recommendations/ai/test', {
    schema: { operationId: 'testRecommendationAIConnection', tags: ['Recommendations'], summary: 'Test the configured recommendation AI provider', response: { 200: ApiSuccess(Type.Object({ ok: Type.Boolean(), errorCode: NullableString }, { additionalProperties: false })), ...ErrorResponses } },
  }, async() => ({ data: await service.testConnection() }))

  app.post('/api/v1/recommendations/ai/reanalyze', {
    schema: { operationId: 'reanalyzeRecommendationAIProfile', tags: ['Recommendations'], summary: 'Reanalyze the retained listening history', response: { 200: ApiSuccess(AIStatus), ...ErrorResponses } },
  }, async() => ({ data: await service.reanalyzeProfile() }))
}
