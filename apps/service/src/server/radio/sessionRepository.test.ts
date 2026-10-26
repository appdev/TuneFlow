import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import type { PlaybackSession } from '../playback/historyRepository'
import { radioPolicy } from './policy'
import { RadioSessionRepository } from './sessionRepository'
import type { RadioBatchRequest, RadioBatchResponse } from './types'

let root: string
let now: number
let id: number
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-radio-session-')); init(root); now = 1_000; id = 0 })
afterEach(() => { close(); rmSync(root, { recursive: true, force: true }) })

const request = (requestId = 'request-1'): RadioBatchRequest => ({ requestId, queueGeneration: 1, currentTrack: null, queuedTracks: [], limit: 3 })
const batch = (sessionId: string): RadioBatchResponse => ({
  sessionId,
  mode: 'dedicated',
  status: 'active',
  aiStatus: 'local',
  profileId: null,
  items: [{ radioSessionId: sessionId, rankingSource: 'local', recommendationItemId: 'item-1', canonicalTrackId: 'track-1', track: { id: 'track-1', source: 'kw', name: 'Song', singer: 'Artist' }, bucket: 'new', reason: { type: 'exploration', labels: [] } }],
})

describe('RadioSessionRepository', () => {
  it('publishes batches atomically and returns identical idempotent retries', () => {
    const repository = new RadioSessionRepository({ now: () => now, createId: () => `session-${++id}` })
    const session = repository.create({ mode: 'dedicated', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    const first = repository.publishBatch(batch(session.sessionId), request())
    expect(repository.publishBatch(batch(session.sessionId), request())).toEqual(first)
    expect(repository.recentItems(session.sessionId)).toHaveLength(1)
    expect(getDB().prepare('SELECT COUNT(*) AS count FROM radio_session_request').get()).toEqual({ count: 1 })
    expect(() => repository.findBatch(session.sessionId, { ...request(), limit: 2 })).toThrow('RADIO_REQUEST_CONFLICT')
  })

  it('keeps device sessions independent and survives repository reconstruction', () => {
    const repository = new RadioSessionRepository({ now: () => now, createId: () => `session-${++id}` })
    const first = repository.create({ mode: 'dedicated', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    const second = repository.create({ mode: 'queue_continuation', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(new RadioSessionRepository({ now: () => now }).getActive(first.sessionId)?.mode).toBe('dedicated')
  })

  it('records resolve and playback transitions once', () => {
    const repository = new RadioSessionRepository({ now: () => now, createId: () => `session-${++id}` })
    const session = repository.create({ mode: 'dedicated', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    repository.publishBatch(batch(session.sessionId), request())
    expect(repository.recordResolve('item-1', 'resolved')).toBe(true)
    const playback: PlaybackSession = { playbackId: 'play-1', track: batch(session.sessionId).items[0].track, platform: 'web', startedAt: 2_000, endedAt: null, completed: false, lastPositionSeconds: null, durationSeconds: null, recommendationItemId: 'item-1' }
    expect(repository.recordPlaybackStart(playback)).toBe(true)
    expect(repository.recordPlaybackStart(playback)).toBe(false)
    expect(repository.recordPlaybackEnd({ ...playback, endedAt: 3_000, completed: true, lastPositionSeconds: 180, durationSeconds: 180 }, { delta: 1.5, accepted: true, earlySkip: false, ratio: 1 })).toBe(true)
    expect(repository.recordPlaybackEnd({ ...playback, endedAt: 4_000, completed: false, lastPositionSeconds: 10, durationSeconds: 180 }, { delta: -1.5, accepted: false, earlySkip: true, ratio: 0.05 })).toBe(false)
    expect(repository.recentItems(session.sessionId)[0]).toMatchObject({ state: 'completed', completionRatio: 1 })
  })

  it('expires at twelve idle hours and cleans closed rows after thirty days', () => {
    const repository = new RadioSessionRepository({ now: () => now, createId: () => `session-${++id}` })
    const session = repository.create({ mode: 'dedicated', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    now += radioPolicy.sessionIdleMs
    expect(repository.getActive(session.sessionId)).toBeNull()
    now += radioPolicy.retentionMs + 1
    new RadioSessionRepository({ now: () => now })
    expect(getDB().prepare('SELECT COUNT(*) AS count FROM radio_session').get()).toEqual({ count: 0 })
  })

  it('closes idempotently and clears only radio sessions', () => {
    const repository = new RadioSessionRepository({ now: () => now, createId: () => `session-${++id}` })
    const session = repository.create({ mode: 'dedicated', initialTrack: null, profileId: null, policyVersion: 'radio-v1' })
    expect(repository.close(session.sessionId)).toBe(true)
    expect(repository.close(session.sessionId)).toBe(false)
    expect(repository.clear()).toBe(1)
  })
})
