import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import { CatalogRepository } from './catalogRepository'
import { RecommendationRanker } from './ranker'
import { TasteRepository } from './tasteRepository'

const DAY = 86_400_000
const NOW = 50 * DAY
let root: string

const track = (index: number, source = 'kw') => ({
  id: `${source}-${index}`,
  source,
  name: `Song ${index}`,
  singer: `Artist ${index}`,
  interval: '03:00',
  meta: { albumName: `Album ${index}` },
})

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-ranker-'))
  init(root)
})

afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

describe('RecommendationRanker', () => {
  it('produces the deterministic 21 new and 9 familiar split', () => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'fixture',
      name: 'Fixture',
      description: '',
      labels: [],
      sampledAt: NOW,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: Array.from({ length: 50 }, (_, index) => track(index)),
    })
    const taste = new TasteRepository(() => NOW, (() => { let id = 0; return () => `feedback-${++id}` })())
    for (let index = 0; index < 12; index += 1) {
      taste.applyPlayback({
        playbackId: `play-${index}`,
        track: track(index),
        platform: 'web',
        startedAt: NOW - 10 * DAY - 180_000,
        endedAt: NOW - 10 * DAY,
        completed: true,
        lastPositionSeconds: 180,
        durationSeconds: 180,
        recommendationItemId: null,
      })
    }

    const ranker = new RecommendationRanker(catalog, taste)
    const input = { exposedToday: new Set<string>(), isPlayableProvider: () => true, sourcePriority: () => 0, now: NOW }
    const first = ranker.rank(input)
    const second = ranker.rank(input)

    expect(first).toHaveLength(30)
    expect(first.filter(item => item.bucket === 'new')).toHaveLength(21)
    expect(first.filter(item => item.bucket === 'familiar')).toHaveLength(9)
    expect(first.filter(item => item.bucket === 'new' && item.reason.type === 'exploration').length).toBeGreaterThanOrEqual(5)
    expect(second.map(item => item.canonicalTrackId)).toEqual(first.map(item => item.canonicalTrackId))
    expect(new Set(first.map(item => item.variant.track.singer)).size).toBe(30)
  })

  it('hard-filters feedback and every same-day exposure', () => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({ source: 'kw', playlistId: 'fixture', name: 'Fixture', description: '', labels: [], sampledAt: NOW, expiresAt: NOW + DAY, reliability: 1, tracks: [track(1), track(2)] })
    const taste = new TasteRepository(() => NOW, () => 'feedback-1')
    const firstCandidate = catalog.candidates()[0]
    taste.recordFeedback({ type: 'not_interested_track', track: firstCandidate.variants[0].track })
    const secondCandidate = catalog.candidates()[1]

    const ranked = new RecommendationRanker(catalog, taste).rank({
      exposedToday: new Set([secondCandidate.canonical.canonicalTrackId]),
      isPlayableProvider: () => true,
      sourcePriority: () => 0,
      now: NOW,
    })
    expect(ranked).toEqual([])
  })

  it('keeps legacy name-at-singer rules exact instead of excluding the title and artist independently', () => {
    const catalog = new CatalogRepository()
    const exact = { ...track(1), name: 'Specific Song', singer: 'Specific Artist' }
    const sameArtist = { ...track(2), name: 'Other Song', singer: 'Specific Artist' }
    const sameTitle = { ...track(3), name: 'Specific Song', singer: 'Other Artist' }
    catalog.replacePlaylist({ source: 'kw', playlistId: 'legacy-dislike', name: 'Fixture', description: '', labels: [], sampledAt: NOW, expiresAt: NOW + DAY, reliability: 1, tracks: [exact, sameArtist, sameTitle] })
    getDB().prepare('INSERT INTO dislike_list(type, content, meta) VALUES (?, ?, ?)').run('music', 'Specific Song@Specific Artist', null)

    const ranked = new RecommendationRanker(catalog, new TasteRepository(() => NOW)).rank({
      exposedToday: new Set(), isPlayableProvider: () => true, sourcePriority: () => 0, now: NOW,
    })

    expect(ranked.map(item => item.variant.track.id).sort()).toEqual([sameArtist.id, sameTitle.id].sort())
  })

  it('enforces artist and album caps without placing identical primary artists adjacently', () => {
    const catalog = new CatalogRepository()
    const concentrated = Array.from({ length: 8 }, (_, index) => ({
      ...track(index),
      name: `Concentrated ${index}`,
      singer: 'Repeated Artist',
      meta: { albumName: 'Repeated Album' },
    }))
    const diverse = Array.from({ length: 32 }, (_, index) => ({
      ...track(index + 100),
      name: `Diverse ${index}`,
    }))
    catalog.replacePlaylist({ source: 'kw', playlistId: 'diversity', name: 'Diversity', description: '', labels: [], sampledAt: NOW, expiresAt: NOW + DAY, reliability: 1, tracks: [...concentrated, ...diverse] })

    const ranked = new RecommendationRanker(catalog, new TasteRepository(() => NOW)).rank({
      exposedToday: new Set(), isPlayableProvider: () => true, sourcePriority: () => 0, now: NOW,
    })

    expect(ranked).toHaveLength(30)
    expect(ranked.filter(item => item.variant.track.singer === 'Repeated Artist')).toHaveLength(2)
    expect(ranked.filter(item => (item.variant.track.meta as { albumName: string }).albumName === 'Repeated Album')).toHaveLength(2)
    expect(ranked.some((item, index) => index > 0 && item.variant.track.singer === ranked[index - 1].variant.track.singer)).toBe(false)
  })

  it('personalizes album and weak-tag affinity from positive seed tracks', () => {
    const catalog = new CatalogRepository()
    const seed = { ...track(1), singer: 'Seed Artist', meta: { albumName: 'Shared Album' } }
    const albumMatch = { ...track(2), singer: 'Different Artist', meta: { albumName: 'Shared Album' } }
    const tagMatch = { ...track(3), singer: 'Tag Artist', meta: { albumName: 'Other Album' } }
    const unrelated = { ...track(4), singer: 'Unrelated Artist', meta: { albumName: 'Unrelated Album' } }
    catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'affinity-fixture',
      name: 'Affinity fixture',
      description: '',
      labels: [],
      sampledAt: NOW,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [seed, albumMatch, tagMatch, unrelated],
    })
    const candidates = catalog.candidates()
    const seedId = candidates.find(item => item.canonical.normalizedTitle === 'song 1')!.canonical.canonicalTrackId
    const tagId = candidates.find(item => item.canonical.normalizedTitle === 'song 3')!.canonical.canonicalTrackId
    getDB().prepare(`INSERT INTO recommendation_track_tag(canonical_id, kind, value, confidence, support, updated_at)
      VALUES (?, 'genre', 'pop', 0.9, 3, ?), (?, 'genre', 'pop', 0.8, 3, ?)`)
      .run(seedId, NOW, tagId, NOW)
    const taste = new TasteRepository(() => NOW, () => 'feedback-1')
    taste.applyPlayback({
      playbackId: 'seed-play',
      track: seed,
      platform: 'web',
      startedAt: NOW - 10 * DAY - 180_000,
      endedAt: NOW - 10 * DAY,
      completed: true,
      lastPositionSeconds: 180,
      durationSeconds: 180,
      recommendationItemId: null,
    })

    const ranked = new RecommendationRanker(catalog, taste).rank({
      exposedToday: new Set<string>(),
      isPlayableProvider: () => true,
      sourcePriority: () => 0,
      now: NOW,
    })

    expect(ranked.find(item => item.variant.track.id === albumMatch.id)?.reason).toMatchObject({ type: 'album_affinity' })
    expect(ranked.find(item => item.variant.track.id === tagMatch.id)?.reason).toEqual({ type: 'tag_affinity', labels: ['pop'] })
    expect(ranked.find(item => item.variant.track.id === unrelated.id)?.reason).toEqual({ type: 'exploration', labels: [] })
  })
})
