import { aiResponsesUrl, isSameAIOrigin } from './aiEndpoint'
import { radioPolicy } from './policy'
import type { AIProfile, AIProfileInput, AIProvider, AIRerankFactor, AIRerankInput, AIRerankResult } from './types'

interface AIClientConfiguration {
  baseUrl: string
  model: string
  apiKey: string
}

interface AIClientOptions {
  getConfiguration: () => AIClientConfiguration
  fetch?: typeof globalThis.fetch
}

class AIClientError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'AIClientError'
  }
}

const profileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['timePreferences', 'recentTrend', 'avoidPatterns'],
  properties: {
    timePreferences: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startHour', 'endHour', 'genres', 'artists', 'energy', 'explorationRatio', 'confidence'],
        properties: {
          startHour: { type: 'integer', minimum: 0, maximum: 23 },
          endHour: { type: 'integer', minimum: 0, maximum: 23 },
          genres: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
          artists: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
          energy: { type: 'number', minimum: 0, maximum: 1 },
          explorationRatio: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    recentTrend: {
      type: 'object',
      additionalProperties: false,
      required: ['genres', 'strength'],
      properties: {
        genres: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
        strength: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    avoidPatterns: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'value', 'strength'],
        properties: {
          type: { enum: ['artist_repeat', 'genre_fatigue'] },
          value: { type: 'string', maxLength: 200 },
          strength: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

const rerankSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking'],
  properties: {
    ranking: {
      type: 'array',
      maxItems: radioPolicy.maxCandidateCount,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateId', 'score', 'factors'],
        properties: {
          candidateId: { type: 'string', maxLength: 100 },
          score: { type: 'number', minimum: 0, maximum: 1 },
          factors: { type: 'array', maxItems: 5, items: { enum: ['time_fit', 'current_track_transition', 'recent_trend', 'exploration', 'familiarity'] } },
        },
      },
    },
  },
} as const

const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null
const finiteUnit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const strings = (value: unknown, max: number, maxLength: number): string[] | null => {
  if (!Array.isArray(value) || value.length > max || value.some(entry => typeof entry !== 'string' || entry.length > maxLength)) return null
  return value as string[]
}
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))

export const parseAIProfile = (value: unknown): AIProfile => {
  const root = object(value)
  if (root == null || !exactKeys(root, ['timePreferences', 'recentTrend', 'avoidPatterns']) || !Array.isArray(root.timePreferences) || root.timePreferences.length > 12 || !Array.isArray(root.avoidPatterns) || root.avoidPatterns.length > 20) throw new AIClientError('AI_INVALID_RESPONSE')
  const timePreferences = root.timePreferences.map(entry => {
    const row = object(entry)
    if (row == null || !exactKeys(row, ['startHour', 'endHour', 'genres', 'artists', 'energy', 'explorationRatio', 'confidence'])) throw new AIClientError('AI_INVALID_RESPONSE')
    const genres = strings(row.genres, 20, 100)
    const artists = strings(row.artists, 20, 200)
    if (!Number.isInteger(row.startHour) || (row.startHour as number) < 0 || (row.startHour as number) > 23 || !Number.isInteger(row.endHour) || (row.endHour as number) < 0 || (row.endHour as number) > 23 || genres == null || artists == null || !finiteUnit(row.energy) || !finiteUnit(row.explorationRatio) || !finiteUnit(row.confidence)) throw new AIClientError('AI_INVALID_RESPONSE')
    return { startHour: row.startHour as number, endHour: row.endHour as number, genres, artists, energy: row.energy, explorationRatio: row.explorationRatio, confidence: row.confidence }
  })
  const recent = object(root.recentTrend)
  const recentGenres = recent == null ? null : strings(recent.genres, 20, 100)
  if (recent == null || !exactKeys(recent, ['genres', 'strength']) || recentGenres == null || !finiteUnit(recent.strength)) throw new AIClientError('AI_INVALID_RESPONSE')
  const avoidPatterns = root.avoidPatterns.map(entry => {
    const row = object(entry)
    if (row == null || !exactKeys(row, ['type', 'value', 'strength']) || !['artist_repeat', 'genre_fatigue'].includes(String(row.type)) || typeof row.value !== 'string' || row.value.length > 200 || !finiteUnit(row.strength)) throw new AIClientError('AI_INVALID_RESPONSE')
    return { type: row.type as 'artist_repeat' | 'genre_fatigue', value: row.value, strength: row.strength }
  })
  return { timePreferences, recentTrend: { genres: recentGenres, strength: recent.strength }, avoidPatterns }
}

const factors = new Set<AIRerankFactor>(['time_fit', 'current_track_transition', 'recent_trend', 'exploration', 'familiarity'])
export const parseAIRerankResult = (value: unknown): AIRerankResult => {
  const root = object(value)
  if (root == null || !exactKeys(root, ['ranking']) || !Array.isArray(root.ranking) || root.ranking.length > radioPolicy.maxCandidateCount) throw new AIClientError('AI_INVALID_RESPONSE')
  const seen = new Set<string>()
  const ranking = root.ranking.map(entry => {
    const row = object(entry)
    if (row == null || !exactKeys(row, ['candidateId', 'score', 'factors']) || typeof row.candidateId !== 'string' || row.candidateId.length > 100 || seen.has(row.candidateId) || !finiteUnit(row.score) || !Array.isArray(row.factors) || row.factors.length > 5 || row.factors.some(factor => typeof factor !== 'string' || !factors.has(factor as AIRerankFactor))) throw new AIClientError('AI_INVALID_RESPONSE')
    seen.add(row.candidateId)
    return { candidateId: row.candidateId, score: row.score, factors: row.factors as AIRerankFactor[] }
  })
  return { ranking }
}

const readBody = async(response: Response): Promise<string> => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > radioPolicy.aiResponseBytes) throw new AIClientError('AI_RESPONSE_TOO_LARGE')
  if (response.body == null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > radioPolicy.aiResponseBytes) {
      await reader.cancel()
      throw new AIClientError('AI_RESPONSE_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

const responseText = (value: unknown): string => {
  const root = object(value)
  if (root == null) throw new AIClientError('AI_INVALID_RESPONSE')
  if (typeof root.output_text === 'string') return root.output_text
  if (!Array.isArray(root.output)) throw new AIClientError('AI_INVALID_RESPONSE')
  for (const output of root.output) {
    const item = object(output)
    if (item == null || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      const part = object(content)
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  throw new AIClientError('AI_INVALID_RESPONSE')
}

export class OpenAICompatibleAIClient implements AIProvider {
  private readonly fetcher: typeof globalThis.fetch

  constructor(private readonly options: AIClientOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  async analyzeProfile(input: AIProfileInput): Promise<AIProfile> {
    return parseAIProfile(await this.complete('tuneflow_radio_profile', profileSchema, 'Analyze listening history into a compact music preference profile. Return only the schema result.', input))
  }

  async rerank(input: AIRerankInput): Promise<AIRerankResult> {
    return parseAIRerankResult(await this.complete('tuneflow_radio_rerank', rerankSchema, 'Reorder only the supplied candidateId values for the current listening context. Return only the schema result.', input))
  }

  async testConnection(): Promise<{ ok: boolean, errorCode: string | null }> {
    try {
      await this.complete('tuneflow_radio_connection', { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean', const: true } } }, 'Return {"ok":true}.', {})
      return { ok: true, errorCode: null }
    } catch (error) {
      return { ok: false, errorCode: error instanceof AIClientError ? error.code : 'AI_UPSTREAM_ERROR' }
    }
  }

  private async complete(name: string, schema: object, instructions: string, input: unknown): Promise<unknown> {
    const config = this.options.getConfiguration()
    if (config.baseUrl === '' || config.model.trim() === '' || config.apiKey.trim() === '') throw new AIClientError('AI_NOT_CONFIGURED')
    const initial = aiResponsesUrl(config.baseUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, radioPolicy.aiTimeoutMs)
    try {
      let target = initial
      for (let redirects = 0; redirects <= 2; redirects++) {
        let response: Response
        try {
          response = await this.fetcher(target, {
            method: 'POST',
            redirect: 'manual',
            signal: controller.signal,
            headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: config.model.trim(),
              store: false,
              instructions,
              input: JSON.stringify(input),
              text: { format: { type: 'json_schema', name, strict: true, schema } },
            }),
          })
        } catch (error) {
          if (controller.signal.aborted) throw new AIClientError('AI_TIMEOUT')
          throw new AIClientError('AI_UPSTREAM_ERROR')
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          if (location == null || redirects === 2) throw new AIClientError('AI_UPSTREAM_ERROR')
          const redirected = new URL(location, target)
          if (!isSameAIOrigin(initial, redirected)) throw new AIClientError('AI_UPSTREAM_ERROR')
          target = redirected
          continue
        }
        const body = await readBody(response)
        if (response.status === 401 || response.status === 403) throw new AIClientError('AI_UNAUTHORIZED')
        if (response.status === 429) throw new AIClientError('AI_RATE_LIMITED')
        if (!response.ok) throw new AIClientError('AI_UPSTREAM_ERROR')
        try { return JSON.parse(responseText(JSON.parse(body))) } catch (error) {
          if (error instanceof AIClientError) throw error
          throw new AIClientError('AI_INVALID_RESPONSE')
        }
      }
      throw new AIClientError('AI_UPSTREAM_ERROR')
    } finally {
      clearTimeout(timer)
    }
  }
}

export const aiErrorCode = (error: unknown): string => error instanceof AIClientError ? error.code : 'AI_UPSTREAM_ERROR'
