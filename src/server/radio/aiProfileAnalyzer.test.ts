import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import type { AIProvider } from './types'
import { AIProfileRepository } from './aiProfileRepository'
import { AIProfileAnalyzer } from './aiProfileAnalyzer'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-ai-analyzer-')); init(root); getDB().exec('CREATE TABLE web_playback_history(ended_at INTEGER)') })
afterEach(() => { close(); rmSync(root, { recursive: true, force: true }) })

const profile = { timePreferences: [], recentTrend: { genres: ['jazz'], strength: 0.7 }, avoidPatterns: [] }
const input = { timeZone: 'UTC', generatedAt: 1, detailedHistoryRangeDays: 30 as const, playbackHistory: [], longTermProfile: { tracks: [], artists: [], albums: [], tags: [] }, explicitFeedback: [] }

describe('AIProfileAnalyzer', () => {
  it('coalesces generation and reuses a fresh profile', async() => {
    let now = 1_000
    let complete!: (value: typeof profile) => void
    const analyzeProfile = vi.fn(async() => await new Promise<typeof profile>(resolve => { complete = resolve }))
    const provider = { analyzeProfile, rerank: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    let id = 0
    const analyzer = new AIProfileAnalyzer({ repository: new AIProfileRepository(), provider, getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), buildInput: () => input, now: () => now, createId: () => `id-${++id}` })
    const first = analyzer.currentOrRefresh()
    const second = analyzer.currentOrRefresh()
    complete(profile)
    await expect(first).resolves.toMatchObject({ source: 'generated', profile })
    await expect(second).resolves.toMatchObject({ source: 'generated', profile })
    expect(analyzeProfile).toHaveBeenCalledTimes(1)
    now += 1_000
    await expect(analyzer.currentOrRefresh()).resolves.toMatchObject({ source: 'fresh' })
    expect(analyzeProfile).toHaveBeenCalledTimes(1)
  })

  it('refreshes after ten ended playbacks and falls back after failure', async() => {
    let now = 1_000
    const provider = { analyzeProfile: vi.fn(async() => profile), rerank: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const repository = new AIProfileRepository()
    let id = 0
    const analyzer = new AIProfileAnalyzer({ repository, provider, getConfiguration: () => ({ enabled: true, configured: true, provider: 'openai-compatible', model: 'model' }), buildInput: () => input, now: () => now, createId: () => `id-${++id}` })
    await analyzer.currentOrRefresh()
    for (let index = 0; index < 10; index += 1) getDB().prepare('INSERT INTO web_playback_history VALUES (?)').run(++now)
    provider.analyzeProfile = vi.fn(async() => { throw new Error('offline') })
    await expect(analyzer.currentOrRefresh()).resolves.toMatchObject({ source: 'stale', errorCode: 'AI_UPSTREAM_ERROR', profile })
  })

  it('stays local when disabled or unconfigured', async() => {
    const repository = new AIProfileRepository()
    const provider = { analyzeProfile: vi.fn(), rerank: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider
    const disabled = new AIProfileAnalyzer({ repository, provider, getConfiguration: () => ({ enabled: false, configured: false, provider: '', model: '' }), buildInput: () => input })
    await expect(disabled.currentOrRefresh()).resolves.toMatchObject({ source: 'local', errorCode: null })
    expect(provider.analyzeProfile).not.toHaveBeenCalled()
  })
})
