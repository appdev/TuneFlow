import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleAIClient, parseAIProfile, parseAIRerankResult } from './aiClient'

const configuration = () => ({ baseUrl: 'https://ai.example.test/v1/', model: 'test-model', apiKey: 'secret-test-key' })
const jsonResponse = (value: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify({ output_text: JSON.stringify(value) }), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const profile = {
  timePreferences: [{ startHour: 22, endHour: 2, genres: ['ambient'], artists: ['artist'], energy: 0.3, explorationRatio: 0.2, confidence: 0.8 }],
  recentTrend: { genres: ['jazz'], strength: 0.7 },
  avoidPatterns: [{ type: 'artist_repeat', value: 'artist', strength: 0.9 }],
}

describe('OpenAI-compatible AI client', () => {
  it('uses Responses structured output without exposing the secret', async() => {
    const fetcher = vi.fn(async(_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-test-key' })
      const body = JSON.parse(String(init?.body)) as { store: boolean, text: { format: { type: string, strict: boolean } } }
      expect(body.store).toBe(false)
      expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
      return jsonResponse(profile)
    })
    const client = new OpenAICompatibleAIClient({ getConfiguration: configuration, fetch: fetcher as typeof fetch })
    await expect(client.analyzeProfile({ timeZone: 'UTC', generatedAt: 1, detailedHistoryRangeDays: 30, playbackHistory: [], longTermProfile: { tracks: [], artists: [], albums: [], tags: [] }, explicitFeedback: [] })).resolves.toEqual(profile)
    expect(fetcher).toHaveBeenCalledWith(new URL('https://ai.example.test/v1/responses'), expect.any(Object))
  })

  it('maps authorization failures without including upstream bodies or credentials', async() => {
    const client = new OpenAICompatibleAIClient({
      getConfiguration: configuration,
      fetch: vi.fn(async() => new Response('secret-test-key upstream detail', { status: 401 })) as typeof fetch,
    })
    await expect(client.testConnection()).resolves.toEqual({ ok: false, errorCode: 'AI_UNAUTHORIZED' })
  })

  it('rejects a cross-origin redirect', async() => {
    const client = new OpenAICompatibleAIClient({
      getConfiguration: configuration,
      fetch: vi.fn(async() => new Response(null, { status: 307, headers: { location: 'https://evil.example/responses' } })) as typeof fetch,
    })
    await expect(client.testConnection()).resolves.toEqual({ ok: false, errorCode: 'AI_UPSTREAM_ERROR' })
  })

  it('rejects oversized responses before parsing them', async() => {
    const client = new OpenAICompatibleAIClient({
      getConfiguration: configuration,
      fetch: vi.fn(async() => new Response('', { status: 200, headers: { 'content-length': String(300 * 1024) } })) as typeof fetch,
    })
    await expect(client.testConnection()).resolves.toEqual({ ok: false, errorCode: 'AI_RESPONSE_TOO_LARGE' })
  })
})

describe('AI schema validation', () => {
  it('accepts the bounded profile', () => { expect(parseAIProfile(profile)).toEqual(profile) })

  it('rejects unknown profile fields and non-finite values', () => {
    expect(() => parseAIProfile({ ...profile, secret: true })).toThrow('AI_INVALID_RESPONSE')
    expect(() => parseAIProfile({ ...profile, recentTrend: { genres: [], strength: Number.NaN } })).toThrow('AI_INVALID_RESPONSE')
  })

  it('rejects duplicate rerank IDs and unknown factors', () => {
    expect(() => parseAIRerankResult({ ranking: [{ candidateId: 'a', score: 1, factors: [] }, { candidateId: 'a', score: 0, factors: [] }] })).toThrow('AI_INVALID_RESPONSE')
    expect(() => parseAIRerankResult({ ranking: [{ candidateId: 'a', score: 1, factors: ['invented'] }] })).toThrow('AI_INVALID_RESPONSE')
  })
})
