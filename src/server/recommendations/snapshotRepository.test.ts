import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import { SnapshotRepository } from './snapshotRepository'
import type { RankedRecommendation } from './types'
import type { PlaybackSession } from '../playback/historyRepository'
import { classifyPlaybackSignal } from './tasteRepository'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-snapshot-'))
  init(root)
})
afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

it('publishes immutable versions and unions same-day exposures', () => {
  let id = 0
  const snapshots = new SnapshotRepository(() => 1_000, () => `id-${++id}`)
  const ranked = (canonicalTrackId: string): RankedRecommendation => ({
    canonicalTrackId,
    variant: { canonicalTrackId, source: 'kw', sourceTrackId: canonicalTrackId, track: { id: canonicalTrackId, source: 'kw', name: canonicalTrackId, singer: 'Artist' }, metadataQuality: 1, lastSeenAt: 1_000 },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  })
  const first = snapshots.publish('2026-08-29', 'ready', ['kw'], [ranked('one')])
  const second = snapshots.publish('2026-08-29', 'degraded', ['kw'], [ranked('two')])

  expect(first.version).toBe(1)
  expect(second.version).toBe(2)
  expect(snapshots.current('2026-08-29')).toEqual(second)
  expect(snapshots.exposedToday('2026-08-29')).toEqual(new Set(['one', 'two']))
})

it('removes snapshot details after 90 days while retaining aggregate exposure', () => {
  let now = 1_000
  let id = 0
  const ranked: RankedRecommendation = {
    canonicalTrackId: 'old-track',
    variant: { canonicalTrackId: 'old-track', source: 'kw', sourceTrackId: 'old-track', track: { id: 'old-track', source: 'kw', name: 'Old', singer: 'Artist' }, metadataQuality: 1, lastSeenAt: now },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  new SnapshotRepository(() => now, () => `id-${++id}`).publish('2026-01-01', 'ready', ['kw'], [ranked])

  now += 91 * 86_400_000
  const restarted = new SnapshotRepository(() => now, () => `id-${++id}`)

  expect(restarted.current('2026-01-01')).toBeNull()
  expect(restarted.exposedToday('2026-01-01')).toEqual(new Set(['old-track']))
  expect(getDB().prepare('SELECT COUNT(*) AS count FROM recommendation_snapshot_item').get()).toEqual({ count: 0 })
  expect(getDB().prepare('SELECT COUNT(*) AS count FROM recommendation_job').get()).toEqual({ count: 0 })
})

it('records recommendation playback effects once per playback id and persists them across restart', () => {
  let id = 0
  const snapshots = new SnapshotRepository(() => 2_000, () => `id-${++id}`)
  const ranked: RankedRecommendation = {
    canonicalTrackId: 'track',
    variant: { canonicalTrackId: 'track', source: 'kw', sourceTrackId: 'track', track: { id: 'track', source: 'kw', name: 'Track', singer: 'Artist' }, metadataQuality: 1, lastSeenAt: 2_000 },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  const item = snapshots.publish('2026-08-29', 'ready', ['kw'], [ranked]).items[0]
  const playback = (playbackId: string, terminal: Partial<PlaybackSession>): PlaybackSession => ({
    playbackId,
    track: item.track,
    platform: 'web',
    startedAt: 2_100,
    endedAt: null,
    completed: false,
    lastPositionSeconds: null,
    durationSeconds: null,
    recommendationItemId: item.recommendationItemId,
    ...terminal,
  })
  const completed = playback('completed', { endedAt: 3_000, completed: true, lastPositionSeconds: 180, durationSeconds: 180 })
  const early = playback('early', { endedAt: 4_000, lastPositionSeconds: 10, durationSeconds: 180 })

  expect(snapshots.recordPlaybackStart(completed)).toBe(true)
  expect(snapshots.recordPlaybackStart(completed)).toBe(false)
  expect(snapshots.recordPlaybackEnd(completed, classifyPlaybackSignal(completed))).toBe(true)
  expect(snapshots.recordPlaybackEnd(completed, classifyPlaybackSignal(completed))).toBe(false)
  expect(snapshots.recordPlaybackEnd(early, classifyPlaybackSignal(early))).toBe(true)
  expect(snapshots.effectStats(item.recommendationItemId)).toEqual({ resolved: null, started: 2, completed: 1, accepted: 1, earlySkip: 1 })
  expect(getDB().prepare('SELECT COUNT(*) AS count FROM recommendation_playback_effect').get()).toEqual({ count: 2 })

  expect(new SnapshotRepository(() => 5_000).effectStats(item.recommendationItemId))
    .toEqual({ resolved: null, started: 2, completed: 1, accepted: 1, earlySkip: 1 })
})

it('migrates existing snapshot items to playback counters without losing rows', () => {
  getDB().exec(`
    CREATE TABLE recommendation_snapshot (
      snapshot_id TEXT PRIMARY KEY, local_date TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      generated_at INTEGER NOT NULL, source_coverage_json TEXT NOT NULL, UNIQUE(local_date, version)
    );
    CREATE TABLE recommendation_snapshot_item (
      snapshot_id TEXT NOT NULL REFERENCES recommendation_snapshot(snapshot_id) ON DELETE CASCADE,
      recommendation_item_id TEXT NOT NULL UNIQUE, canonical_id TEXT NOT NULL, position INTEGER NOT NULL,
      item_json TEXT NOT NULL, resolve_outcome TEXT, PRIMARY KEY(snapshot_id, position)
    );
    INSERT INTO recommendation_snapshot VALUES ('snapshot', '2026-08-29', 1, 'ready', 1000, '[]');
    INSERT INTO recommendation_snapshot_item VALUES ('snapshot', 'item', 'track', 0, '{}', NULL);
  `)

  const snapshots = new SnapshotRepository(() => 2_000)
  expect(snapshots.effectStats('item')).toEqual({ resolved: null, started: 0, completed: 0, accepted: 0, earlySkip: 0 })
  expect(getDB().prepare('SELECT recommendation_item_id AS id FROM recommendation_snapshot_item').all()).toEqual([{ id: 'item' }])
})
