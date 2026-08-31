import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIST_IDS } from '../../common/constants'
import { close, getDB, init } from '../db/core/db'
import type { PlaybackSession } from '../playback/historyRepository'
import { canonicalizeTrack } from './identity'
import { TasteRepository } from './tasteRepository'

const DAY = 86_400_000
const BASE_NOW = 50 * DAY
let root: string

const track = (id: string) => ({ id, source: 'kw', name: `Song ${id}`, singer: `Artist ${id}`, interval: '03:00', meta: { albumName: `Album ${id}` } })
const session = (playbackId: string, id: string, input: Partial<PlaybackSession> = {}): PlaybackSession => ({
  playbackId,
  track: track(id),
  platform: 'web',
  startedAt: BASE_NOW - 180_000,
  endedAt: BASE_NOW,
  completed: true,
  lastPositionSeconds: 180,
  durationSeconds: 180,
  recommendationItemId: null,
  ...input,
})

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-taste-'))
  init(root)
})

afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

describe('TasteRepository', () => {
  it('applies each playback once and decays only implicit evidence by a 30-day half-life', () => {
    let now = BASE_NOW
    const taste = new TasteRepository(() => now)
    const completed = session('play-1', 'one')

    expect(taste.applyPlayback(completed)).toBe(true)
    expect(taste.applyPlayback(completed)).toBe(false)
    const initial = taste.facts().get(canonicalizeTrack(completed.track)!.canonicalTrackId)!
    expect(initial).toMatchObject({ playCount: 1, completedCount: 1, earlySkipCount: 0 })
    expect(taste.seeds()[0].track).toMatchObject({ id: 'one', name: 'Song one' })

    now += 30 * DAY
    expect(taste.facts().get(initial.canonicalTrackId)?.score).toBeCloseTo(initial.score / 2)
  })

  it('keeps explicit love facts durable and removes them when the source fact disappears', () => {
    let now = BASE_NOW
    const taste = new TasteRepository(() => now)
    getDB().prepare('INSERT INTO my_list_music_info(id, listId, name, singer, source, interval, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('love-song', LIST_IDS.LOVE, 'Loved Song', 'Loved Artist', 'kw', '03:00', '{}')

    taste.syncExplicitFacts()
    const canonicalId = canonicalizeTrack({ id: 'love-song', source: 'kw', name: 'Loved Song', singer: 'Loved Artist' })!.canonicalTrackId
    expect(taste.facts().get(canonicalId)?.score).toBe(4)
    expect(taste.artistScores().get('loved artist')).toBe(4)

    now += 365 * DAY
    expect(taste.facts().get(canonicalId)?.score).toBe(4)

    getDB().prepare('DELETE FROM my_list_music_info WHERE id=? AND listId=?').run('love-song', LIST_IDS.LOVE)
    taste.syncExplicitFacts()
    expect(taste.facts().has(canonicalId)).toBe(false)
  })

  it('migrates legacy taste rows with nullable track metadata', () => {
    getDB().exec(`
      CREATE TABLE recommendation_taste_track (
        canonical_id TEXT PRIMARY KEY, score REAL NOT NULL, play_count INTEGER NOT NULL,
        completed_count INTEGER NOT NULL, early_skip_count INTEGER NOT NULL,
        last_played_at INTEGER, updated_at INTEGER NOT NULL
      );
      INSERT INTO recommendation_taste_track VALUES ('legacy', 2, 1, 1, 0, 100, 100);
    `)
    const taste = new TasteRepository(() => BASE_NOW)
    expect(taste.seeds()[0]).toMatchObject({ canonicalTrackId: 'legacy', track: null })
  })

  it('persists explicit exclusions until an explicit undo', () => {
    let id = 0
    const taste = new TasteRepository(() => BASE_NOW, () => `feedback-${++id}`)
    const feedback = taste.recordFeedback({ type: 'not_interested_track', track: track('blocked') })
    const canonicalId = canonicalizeTrack(track('blocked'))!.canonicalTrackId

    expect(taste.exclusions().tracks).toContain(canonicalId)
    expect(taste.recordFeedback({ type: 'not_interested_track', track: track('blocked') })).toEqual(feedback)
    expect(taste.recordFeedback({ type: 'undo', feedbackId: feedback.feedbackId })).toMatchObject({ active: false, type: 'undo' })
    expect(taste.exclusions().tracks).not.toContain(canonicalId)
  })

  it('scores interested tracks at +3 and keeps positive and negative track feedback mutually exclusive', () => {
    let id = 0
    const taste = new TasteRepository(() => BASE_NOW, () => `feedback-${++id}`)
    const candidate = track('interested')
    const canonicalId = canonicalizeTrack(candidate)!.canonicalTrackId

    const interested = taste.recordFeedback({ type: 'interested_track', track: candidate })
    expect(taste.interestedFeedback().get(canonicalId)).toBe(interested.feedbackId)
    expect(taste.facts().get(canonicalId)?.score).toBe(3)
    expect(taste.seeds()[0]).toMatchObject({ canonicalTrackId: canonicalId, track: { id: 'interested' } })
    expect(taste.artistScores().get('artist interested')).toBe(3)

    const rejected = taste.recordFeedback({ type: 'not_interested_track', track: candidate })
    expect(taste.interestedFeedback().has(canonicalId)).toBe(false)
    expect(taste.facts().has(canonicalId)).toBe(false)
    expect(taste.exclusions().tracks).toContain(canonicalId)

    taste.recordFeedback({ type: 'interested_track', track: candidate })
    expect(taste.exclusions().tracks).not.toContain(canonicalId)
    expect(taste.recordFeedback({ type: 'undo', feedbackId: rejected.feedbackId })).toMatchObject({ active: false, type: 'undo' })
  })

  it('uses the frozen playback weights and requires both a short position and low ratio for an early skip', () => {
    const taste = new TasteRepository(() => BASE_NOW)
    const cases = [
      session('complete', 'complete'),
      session('eighty', 'eighty', { completed: false, lastPositionSeconds: 80, durationSeconds: 100 }),
      session('half', 'half', { completed: false, lastPositionSeconds: 50, durationSeconds: 100 }),
      session('late-low-ratio', 'late-low-ratio', { completed: false, lastPositionSeconds: 40, durationSeconds: 200 }),
      session('boundary-30', 'boundary-30', { completed: false, lastPositionSeconds: 30, durationSeconds: 200 }),
      session('early', 'early', { completed: false, lastPositionSeconds: 20, durationSeconds: 200 }),
    ]
    for (const item of cases) taste.applyPlayback(item)
    const facts = taste.facts()
    const fact = (id: string) => facts.get(canonicalizeTrack(track(id))!.canonicalTrackId)!

    expect(fact('complete').score).toBe(1.5)
    expect(fact('eighty').score).toBe(1)
    expect(fact('half').score).toBe(0.4)
    expect(fact('late-low-ratio').earlySkipCount).toBe(0)
    expect(fact('boundary-30').earlySkipCount).toBe(0)
    expect(fact('early')).toMatchObject({ score: -1.5, earlySkipCount: 1 })
  })

  it('caps repeated implicit playback so a loop cannot dominate the profile', () => {
    const taste = new TasteRepository(() => BASE_NOW)
    for (let index = 0; index < 20; index += 1) taste.applyPlayback(session(`repeat-${index}`, 'repeat'))
    const canonicalId = canonicalizeTrack(track('repeat'))!.canonicalTrackId
    expect(taste.facts().get(canonicalId)!.score).toBeLessThan(10)
  })

  it('returns a bounded deterministic snapshot for AI analysis', () => {
    const taste = new TasteRepository(() => BASE_NOW)
    taste.applyPlayback(session('play-b', 'b'))
    taste.applyPlayback(session('play-a', 'a', { completed: false, lastPositionSeconds: 20, durationSeconds: 200 }))
    const snapshot = taste.snapshot(1)
    expect(snapshot.tracks).toHaveLength(1)
    expect(snapshot.tracks[0]).toMatchObject({ playCount: 1, completionCount: 1, earlySkipCount: 0 })
    expect(snapshot.artists).toHaveLength(1)
    expect(snapshot.tags).toEqual([])
  })

  it('does not promote audition, temporary, download, or local pseudo-lists to explicit preferences', () => {
    const taste = new TasteRepository(() => BASE_NOW)
    const insert = getDB().prepare('INSERT INTO my_list_music_info(id, listId, name, singer, source, interval, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const [index, listId] of [LIST_IDS.DEFAULT, LIST_IDS.TEMP, LIST_IDS.DOWNLOAD, LIST_IDS.LOCAL].entries()) {
      insert.run(`pseudo-${index}`, listId, `Pseudo ${index}`, `Artist ${index}`, 'kw', '03:00', '{}')
    }

    taste.syncExplicitFacts()
    expect(taste.facts()).toEqual(new Map())
  })

  it('keeps a legacy name-at-singer dislike scoped to the exact track pattern', () => {
    const taste = new TasteRepository(() => BASE_NOW)
    getDB().prepare('INSERT INTO dislike_list(type, content, meta) VALUES (?, ?, ?)')
      .run('music', 'Specific Song@Specific Artist', null)

    const exclusions = taste.exclusions()
    expect(exclusions.titles).not.toContain('specific song')
    expect(exclusions.artists).not.toContain('specific artist')
    expect(exclusions.trackPatterns).toHaveLength(1)
  })
})
