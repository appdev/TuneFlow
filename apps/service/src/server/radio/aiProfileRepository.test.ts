import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import { AIProfileRepository } from './aiProfileRepository'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-ai-profile-')); init(root); getDB().exec('CREATE TABLE web_playback_history(ended_at INTEGER)') })
afterEach(() => { close(); rmSync(root, { recursive: true, force: true }) })

const profile = { timePreferences: [], recentTrend: { genres: [], strength: 0 }, avoidPatterns: [] }

describe('AIProfileRepository', () => {
  it('persists complete profiles and run evidence without raw history', () => {
    const repository = new AIProfileRepository()
    repository.saveComplete({ profileId: 'p1', generatedAt: 100, expiresAt: 200, provider: 'openai-compatible', model: 'model', promptVersion: 'v1', inputHistoryCutoff: 100, inputFingerprint: 'hash', profile })
    repository.recordRun({ runId: 'r1', purpose: 'profile', startedAt: 90, finishedAt: 100, provider: 'openai-compatible', model: 'model', inputFingerprint: 'hash', candidateCount: 0, status: 'complete', errorCode: null })
    expect(repository.latest({ provider: 'openai-compatible', model: 'model', promptVersion: 'v1', minimumGeneratedAt: 0 })?.profileId).toBe('p1')
    expect(repository.latestRun('profile')).toEqual({ errorCode: null, finishedAt: 100, status: 'complete' })
    const tables = JSON.stringify(getDB().prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'recommendation_ai_%'").all())
    expect(tables).not.toContain('playbackHistory')
  })

  it('counts new terminal playbacks and clears only AI data', () => {
    const repository = new AIProfileRepository()
    getDB().prepare('INSERT INTO web_playback_history VALUES (?)').run(101)
    getDB().prepare('INSERT INTO web_playback_history VALUES (?)').run(null)
    expect(repository.endedPlaybackCountSince(100)).toBe(1)
    repository.recordRun({ runId: 'r1', purpose: 'profile', startedAt: 1, finishedAt: 2, provider: 'p', model: 'm', inputFingerprint: 'h', candidateCount: 0, status: 'failed', errorCode: 'AI_TIMEOUT' })
    expect(repository.clear()).toBe(1)
  })
})
