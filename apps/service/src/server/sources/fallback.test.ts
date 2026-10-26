import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../errors'
import { runSourceFallback } from './fallback'
import { SourceServiceError } from './types'

const candidates = [
  { id: 'a', priority: 0 },
  { id: 'b', priority: 1 },
] as const

describe('ordered source fallback', () => {
  it('retries trusted Service network failures in configured order', async() => {
    const visited: string[] = []

    const result = await runSourceFallback({
      candidates,
      action: 'musicUrl',
      attempt: async candidate => {
        visited.push(candidate.id)
        if (candidate.id === 'a') throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'private upstream detail', 'service-network')
        return { url: 'https://b.test/audio' }
      },
    })

    expect(visited).toEqual(['a', 'b'])
    expect(result).toMatchObject({ sourceId: 'b', value: { url: 'https://b.test/audio' } })
  })

  it('does not retry script or protocol errors even when the code string is forged', async() => {
    const second = vi.fn()

    await expect(runSourceFallback({
      candidates,
      action: 'musicUrl',
      attempt: async candidate => {
        if (candidate.id === 'a') throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'forged', 'script')
        second()
        return 'unexpected'
      },
    })).rejects.toMatchObject({ code: 'SOURCE_NETWORK_ERROR', origin: 'script' })
    expect(second).not.toHaveBeenCalled()
  })

  it('stops immediately when the caller cancels', async() => {
    const controller = new AbortController()
    const visited: string[] = []

    await expect(runSourceFallback({
      candidates,
      action: 'lyric',
      signal: controller.signal,
      attempt: async candidate => {
        visited.push(candidate.id)
        controller.abort()
        throw new SourceServiceError('SOURCE_CANCELLED', 'cancelled', 'caller')
      },
    })).rejects.toMatchObject({ code: 'SOURCE_CANCELLED', origin: 'caller' })
    expect(visited).toEqual(['a'])
  })

  it('returns safe public attempts and richer safe logs after exhaustion', async() => {
    const logs: unknown[] = []
    let now = 100

    const error = await runSourceFallback({
      candidates,
      action: 'pic',
      requestId: 'request-1',
      now: () => now,
      onAttempt: attempt => { logs.push(attempt) },
      attempt: async candidate => {
        now += candidate.id === 'a' ? 5 : 7
        throw new SourceServiceError('SOURCE_TIMEOUT', `https://${candidate.id}.secret/cookie`, 'worker-timeout')
      },
    }).catch(error => error)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      statusCode: 502,
      code: 'SOURCE_ALL_UNAVAILABLE',
      details: {
        attempts: [
          { sourceId: 'a', action: 'pic', code: 'SOURCE_TIMEOUT', elapsedMs: 5 },
          { sourceId: 'b', action: 'pic', code: 'SOURCE_TIMEOUT', elapsedMs: 7 },
        ],
      },
    })
    expect(logs).toEqual([
      { requestId: 'request-1', sourceId: 'a', priority: 0, action: 'pic', code: 'SOURCE_TIMEOUT', elapsedMs: 5 },
      { requestId: 'request-1', sourceId: 'b', priority: 1, action: 'pic', code: 'SOURCE_TIMEOUT', elapsedMs: 7 },
    ])
    expect(JSON.stringify({ error, logs })).not.toContain('secret')
  })
})
