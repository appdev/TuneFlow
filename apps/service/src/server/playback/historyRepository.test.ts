import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import { PlaybackHistoryRepository } from './historyRepository'

const DAY = 86_400_000
let storageRoot: string

beforeEach(() => {
  storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-playback-history-'))
  expect(init(storageRoot)).toBe(false)
})

afterEach(() => {
  close()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('PlaybackHistoryRepository', () => {
  it('stores every playback as an independent newest-first session', () => {
    let now = 1_000
    let id = 0
    const history = new PlaybackHistoryRepository({ now: () => now, createId: () => `play-${++id}` })

    const first = history.start({ id: 'same', source: 'kw', name: 'First' }, 'android')
    now = 2_000
    const second = history.start({ id: 'same', source: 'kw', name: 'Second' }, 'web')

    expect(first).toMatchObject({ playbackId: 'play-1', platform: 'android', startedAt: 1_000, endedAt: null, completed: false })
    expect(history.list()).toEqual([second, first])
  })

  it('ends a session once and preserves the first terminal facts', () => {
    let now = 1_000
    const history = new PlaybackHistoryRepository({ now: () => now, createId: () => 'play-1' })
    history.start({ id: 'song', source: 'kw' }, 'ios')
    now = 2_000

    const ended = history.end('play-1', { completed: false, lastPositionSeconds: 12.5, durationSeconds: 180 })
    now = 3_000
    const repeated = history.end('play-1', { completed: true, lastPositionSeconds: 180, durationSeconds: 180 })

    expect(ended).toMatchObject({ endedAt: 2_000, completed: false, lastPositionSeconds: 12.5, durationSeconds: 180 })
    expect(repeated).toEqual(ended)
    expect(history.end('missing', { completed: false, lastPositionSeconds: 0, durationSeconds: 0 })).toBeUndefined()
  })

  it('keeps the exact 30-day boundary without a count cap and deletes older rows', () => {
    let now = 40 * DAY
    let id = 0
    const history = new PlaybackHistoryRepository({ now: () => now, createId: () => `play-${++id}` })

    now = 10 * DAY
    const boundary = history.start({ id: 'boundary', source: 'kw' }, 'web')
    now += 1
    history.start({ id: 'inside', source: 'kw' }, 'web')
    for (let index = 0; index < 55; index++) history.start({ id: `track-${index}`, source: 'kw' }, 'web')
    now = 40 * DAY

    const entries = history.list()
    expect(entries).toHaveLength(57)
    expect(entries).toContainEqual(boundary)

    now += 1
    expect(history.list().some(entry => entry.playbackId === boundary.playbackId)).toBe(false)
  })

  it('persists the new schema across restart without clearing it again', () => {
    const history = new PlaybackHistoryRepository({ now: () => 1_234, createId: () => 'persisted-play' })
    const stored = history.start({ id: 'persisted', source: 'tx', name: 'Persisted' }, 'macos')

    close()
    expect(init(storageRoot)).toBe(true)

    expect(new PlaybackHistoryRepository({ now: () => 1_235 }).list()).toEqual([stored])
  })

  it('adds recommendation attribution to the production schema without deleting sessions', () => {
    getDB().exec(`
      CREATE TABLE web_playback_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        playback_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        track_json TEXT NOT NULL,
        platform TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        last_position_seconds REAL,
        duration_seconds REAL
      );
      CREATE INDEX index_web_playback_history_order ON web_playback_history(started_at DESC, sequence DESC);
      INSERT INTO web_playback_history(playback_id, source, track_id, track_json, platform, started_at, ended_at, completed, last_position_seconds, duration_seconds)
      VALUES ('preserved', 'kw', 'song', '{"id":"song","source":"kw"}', 'web', 1000, 2000, 1, 180, 180);
    `)

    const history = new PlaybackHistoryRepository({ now: () => 2_001 })
    expect(history.list()).toEqual([expect.objectContaining({ playbackId: 'preserved', completed: true, recommendationItemId: null })])
  })

  it('persists optional recommendation attribution without changing legacy callers', () => {
    let id = 0
    const history = new PlaybackHistoryRepository({ now: () => 1_234, createId: () => `play-${++id}` })
    const attributed = history.start({ id: 'recommended', source: 'kw' }, 'web', 'recommendation-item-1')
    const manual = history.start({ id: 'manual', source: 'kw' }, 'web')

    expect(attributed.recommendationItemId).toBe('recommendation-item-1')
    expect(manual.recommendationItemId).toBeNull()

    close()
    expect(init(storageRoot)).toBe(true)
    expect(new PlaybackHistoryRepository({ now: () => 1_235 }).list()).toEqual([
      expect.objectContaining({ playbackId: manual.playbackId, recommendationItemId: null }),
      expect.objectContaining({ playbackId: attributed.playbackId, recommendationItemId: 'recommendation-item-1' }),
    ])
  })

  it('replaces the test-stage legacy table once', () => {
    getDB().exec(`
      CREATE TABLE web_playback_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        track_json TEXT NOT NULL,
        played_at INTEGER NOT NULL,
        UNIQUE(source, track_id)
      );
      INSERT INTO web_playback_history(source, track_id, track_json, played_at)
      VALUES ('kw', 'legacy', '{"id":"legacy","source":"kw"}', 1000);
    `)

    const history = new PlaybackHistoryRepository({ now: () => 2_000, createId: () => 'new-play' })
    expect(history.list()).toEqual([])
    expect(history.start({ id: 'new', source: 'kw' }, 'linux').playbackId).toBe('new-play')
  })
})
