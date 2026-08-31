import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close, init } from '../db/core/db'
import type { RankedRecommendation } from '../recommendations/types'
import { AIProfileRepository } from './aiProfileRepository'
import { AICandidateReranker } from './aiReranker'
import type { AIProvider } from './types'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-ai-rerank-')); init(root) })
afterEach(() => { close(); rmSync(root, { recursive: true, force: true }) })

const candidate = (id: string): RankedRecommendation => ({
  canonicalTrackId: id,
  bucket: 'new',
  reason: { type: 'exploration', labels: [] },
  score: 1,
  variant: { canonicalTrackId: id, source: 'kw', sourceTrackId: id, track: { id, source: 'kw', name: id, singer: id }, metadataQuality: 1, lastSeenAt: 1 },
})

describe('AICandidateReranker', () => {
  it('applies valid AI order, appends omissions, and caches identical context', async() => {
    const provider = { rerank: vi.fn(async() => ({ ranking: [{ candidateId: 'candidate-1', score: 1, factors: ['time_fit'] }] })), analyzeProfile: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const reranker = new AICandidateReranker({ provider, repository: new AIProfileRepository(), getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), now: () => 1, createId: () => 'run-1' })
    const options = { profileId: null, profile: null, currentTrack: null, recentItems: [], candidates: [candidate('a'), candidate('b')] }
    await expect(reranker.rerank(options)).resolves.toMatchObject({ source: 'ai', ordered: [{ canonicalTrackId: 'b' }, { canonicalTrackId: 'a' }] })
    await reranker.rerank(options)
    expect(provider.rerank).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown AI candidate IDs and stays local', async() => {
    const provider = { rerank: vi.fn(async() => ({ ranking: [{ candidateId: 'invented', score: 1, factors: [] }] })), analyzeProfile: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const reranker = new AICandidateReranker({ provider, repository: new AIProfileRepository(), getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), now: () => 1, createId: () => 'run-1' })
    await expect(reranker.rerank({ profileId: null, profile: null, currentTrack: null, recentItems: [], candidates: [candidate('a')] })).resolves.toMatchObject({ source: 'local', errorCode: 'AI_UNKNOWN_CANDIDATE', ordered: [{ canonicalTrackId: 'a' }] })
  })

  it('sends the Service-resolved local hour to AI', async() => {
    const provider = { rerank: vi.fn(async() => ({ ranking: [] })), analyzeProfile: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const reranker = new AICandidateReranker({ provider, repository: new AIProfileRepository(), getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), now: () => 1, createId: () => 'run-1' })
    await reranker.rerank({ profileId: null, profile: null, currentTrack: null, recentItems: [], candidates: [candidate('a')], localHour: 21 })
    expect(provider.rerank).toHaveBeenCalledWith(expect.objectContaining({ localHour: 21 }))
  })

  it('opens the circuit after repeated failures', async() => {
    let now = 1
    const provider = { rerank: vi.fn(async() => { throw new Error('offline') }), analyzeProfile: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const reranker = new AICandidateReranker({ provider, repository: new AIProfileRepository(), getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), now: () => now, createId: () => `run-${now}` })
    for (let index = 0; index < 3; index += 1) { now += 1; await reranker.rerank({ profileId: null, profile: null, currentTrack: { id: index }, recentItems: [], candidates: [candidate(`a-${index}`)] }) }
    await expect(reranker.rerank({ profileId: null, profile: null, currentTrack: { id: 4 }, recentItems: [], candidates: [candidate('a-4')] })).resolves.toMatchObject({ source: 'local', errorCode: 'AI_CIRCUIT_OPEN' })
    expect(provider.rerank).toHaveBeenCalledTimes(3)
  })
})
