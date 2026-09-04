import { describe, expect, it } from 'vitest'
import { radioPolicy } from './policy'

describe('radio policy', () => {
  it('keeps the approved v1 limits stable', () => {
    expect(radioPolicy).toMatchObject({
      version: 'radio-v1',
      batchSize: 10,
      maxCandidateCount: 50,
      maxQueuedTrackCount: 100,
      sessionIdleMs: 12 * 60 * 60_000,
      retentionMs: 30 * 86_400_000,
      profileFreshMs: 24 * 60 * 60_000,
      profileFallbackMs: 7 * 86_400_000,
      profilePlaybackThreshold: 10,
      aiTimeoutMs: 3_000,
      circuitFailureThreshold: 3,
      maxHourlyReranks: 60,
      artistGap: 2,
      albumGap: 3,
    })
  })
})
