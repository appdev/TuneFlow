import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { close, init } from '../db/core/db'
import { CatalogRepository } from './catalogRepository'
import { canonicalizeTrack } from './identity'
import { CatalogSampler } from './catalogSampler'
import { RecommendationRanker } from './ranker'
import { RelationIndex } from './relationIndex'
import { RecommendationService } from './service'
import { SnapshotRepository } from './snapshotRepository'
import { TasteRepository } from './tasteRepository'
import type { RankedRecommendation } from './types'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-service-'))
  init(root)
})
afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

it('keeps one stable daily snapshot and fully replaces it on a coalesced refresh', async() => {
  let id = 0
  const now = 1_777_593_600_000
  const catalog = new CatalogRepository()
  catalog.replacePlaylist({
    source: 'kw',
    playlistId: 'fixture',
    name: 'Fixture',
    description: '',
    labels: [],
    sampledAt: now,
    expiresAt: now + 86_400_000,
    reliability: 1,
    tracks: Array.from({ length: 70 }, (_, index) => ({
      id: `track-${index}`,
      source: 'kw',
      name: `Track ${index}`,
      singer: `Artist ${index}`,
      interval: '03:00',
      meta: { albumName: `Album ${index}` },
    })),
  })
  const taste = new TasteRepository(() => now, () => `feedback-${++id}`)
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const publish = vi.fn()
  const service = new RecommendationService({
    sampler: new CatalogSampler(catalog, new RelationIndex(catalog, () => now), {
      providers: () => [{
        id: 'kw',
        name: 'Kuwo',
        searchKinds: ['track', 'playlist'],
        leaderboards: false,
        albumDetail: false,
        playlistDiscovery: { tags: true, browse: true, detail: true },
      }],
      isPlayableProvider: () => true,
      now: () => now,
      getTags: async source => ({ source, sorts: [], hotTags: [], groups: [] }),
      browse: async({ source }) => ({ source, page: 1, limit: 1, total: 1, hasMore: false, list: [{ id: 'fixture', kind: 'playlist', name: 'Fixture', source }] }),
      detail: async() => { throw new Error('recent playlist must not be fetched') },
    }),
    ranker: new RecommendationRanker(catalog, taste),
    snapshots,
    taste,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish,
    now: () => now,
    createId: () => `generation-${++id}`,
  })

  expect(service.daily()).toMatchObject({ status: 'warming', items: [] })
  await service.waitForIdle()
  const first = service.daily()
  expect(first).toMatchObject({ status: 'ready', version: 1, sourceCoverage: ['kw'] })
  expect(first.items).toHaveLength(30)
  expect(service.daily()).toEqual(first)

  const refreshOne = service.refresh()
  const refreshTwo = service.refresh()
  expect(refreshTwo.generationId).toBe(refreshOne.generationId)
  expect(service.daily()).toMatchObject({ status: 'generating', version: 1 })
  await service.waitForIdle()
  const second = service.daily()
  expect(second).toMatchObject({ status: 'ready', version: 2, sourceCoverage: ['kw'] })
  expect(second.items).toHaveLength(30)
  expect(second.items.some(item => first.items.some(previous => previous.canonicalTrackId === item.canonicalTrackId))).toBe(false)
  expect(publish).toHaveBeenCalledTimes(2)
  await service.close()
})

it('keeps the old snapshot visible when refresh generation fails', async() => {
  let id = 0
  const now = 1_777_593_600_000
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const ranked: RankedRecommendation = {
    canonicalTrackId: 'stable',
    variant: { canonicalTrackId: 'stable', source: 'kw', sourceTrackId: 'stable', track: { id: 'stable', source: 'kw', name: 'Stable', singer: 'Artist' }, metadataQuality: 1, lastSeenAt: now },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  const previous = snapshots.publish('2026-05-01', 'ready', ['kw'], [ranked])
  const publish = vi.fn()
  const service = new RecommendationService({
    sampler: { run: async() => { throw Object.assign(new Error('sample failed'), { code: 'UPSTREAM_FAILED' }) }, close: () => {} } as unknown as CatalogSampler,
    ranker: { rank: () => { throw new Error('ranker must not run') } } as unknown as RecommendationRanker,
    snapshots,
    taste: { syncExplicitFacts: () => {}, recordFeedback: vi.fn(), clearProfile: vi.fn() } as unknown as TasteRepository,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish,
    now: () => now,
    createId: () => `generation-${++id}`,
  })

  service.refresh()
  expect(service.daily()).toMatchObject({ status: 'generating', version: 1, items: previous.items })
  await service.waitForIdle()

  expect(service.daily()).toEqual({
    ...previous,
    items: previous.items.map(item => ({ ...item, feedback: { interested: false, interestedFeedbackId: null } })),
  })
  expect(service.status()).toMatchObject({ status: 'ready', version: 1, lastErrorCode: 'UPSTREAM_FAILED' })
  expect(publish).toHaveBeenCalledWith({
    ...previous,
    items: previous.items.map(item => ({ ...item, feedback: { interested: false, interestedFeedbackId: null } })),
  })
  await service.close()
})

it('publishes degraded when candidates exist but no playable catalog provider is eligible', async() => {
  let id = 0
  const now = 1_777_593_600_000
  const catalog = new CatalogRepository()
  catalog.replacePlaylist({
    source: 'kw',
    playlistId: 'stale-coverage',
    name: 'Fixture',
    description: '',
    labels: [],
    sampledAt: now,
    expiresAt: now + 86_400_000,
    reliability: 1,
    tracks: Array.from({ length: 12 }, (_, index) => ({ id: `track-${index}`, source: 'kw', name: `Track ${index}`, singer: `Artist ${index}` })),
  })
  const taste = new TasteRepository(() => now)
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const service = new RecommendationService({
    sampler: new CatalogSampler(catalog, new RelationIndex(catalog, () => now), { providers: () => [], isPlayableProvider: () => false, now: () => now }),
    ranker: new RecommendationRanker(catalog, taste),
    snapshots,
    taste,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish: vi.fn(),
    now: () => now,
    createId: () => `generation-${++id}`,
  })

  expect(service.daily().status).toBe('warming')
  await service.waitForIdle()
  expect(service.daily()).toMatchObject({ status: 'degraded', sourceCoverage: [] })
  expect(service.status().lastErrorCode).toBe('RECOMMENDATION_SOURCE_COVERAGE_DEGRADED')
  await service.close()
})

it('serves the latest complete snapshot as stale when the new local day fails', async() => {
  let id = 0
  const now = Date.UTC(2026, 4, 2, 12)
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const ranked: RankedRecommendation = {
    canonicalTrackId: 'yesterday',
    variant: { canonicalTrackId: 'yesterday', source: 'kw', sourceTrackId: 'yesterday', track: { id: 'yesterday', source: 'kw', name: 'Yesterday', singer: 'Artist' }, metadataQuality: 1, lastSeenAt: now },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  snapshots.publish('2026-05-01', 'ready', ['kw'], [ranked])
  const service = new RecommendationService({
    sampler: { run: async() => { throw Object.assign(new Error('offline'), { code: 'MUSICBRAINZ_UNREACHABLE' }) }, close: () => {} } as unknown as CatalogSampler,
    ranker: { rank: () => [] } as unknown as RecommendationRanker,
    snapshots,
    taste: { syncExplicitFacts: () => {}, recordFeedback: vi.fn(), clearProfile: vi.fn() } as unknown as TasteRepository,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish: vi.fn(),
    now: () => now,
    createId: () => `generation-${++id}`,
  })

  expect(service.daily()).toMatchObject({ status: 'stale', localDate: '2026-05-02', snapshotLocalDate: '2026-05-01', version: 1 })
  await service.waitForIdle()
  expect(service.daily()).toMatchObject({ status: 'stale', lastErrorCode: 'MUSICBRAINZ_UNREACHABLE' })
  await service.close()
})

it('does not start generation when MusicBrainz is explicitly disabled', async() => {
  const sampler = { run: vi.fn(), close: () => {} }
  const service = new RecommendationService({
    sampler: sampler as unknown as CatalogSampler,
    ranker: { rank: () => [] } as unknown as RecommendationRanker,
    snapshots: new SnapshotRepository(),
    taste: { recordFeedback: vi.fn(), clearProfile: vi.fn() } as unknown as TasteRepository,
    getTimeZone: () => 'UTC',
    getMusicBrainzBaseUrl: () => '',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish: vi.fn(),
  })

  expect(service.daily()).toMatchObject({ status: 'disabled', snapshotLocalDate: null, items: [] })
  expect(service.status()).toMatchObject({ status: 'disabled', generationId: null })
  expect(sampler.run).not.toHaveBeenCalled()
  await service.close()
})

it('applies current feedback while keeping the stored snapshot immutable', async() => {
  let id = 0
  const now = Date.UTC(2026, 4, 1, 12)
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const blockedTrack = { id: 'blocked', source: 'kw', name: 'Blocked', singer: 'Artist' }
  const canonicalTrackId = canonicalizeTrack(blockedTrack)!.canonicalTrackId
  const ranked: RankedRecommendation = {
    canonicalTrackId,
    variant: { canonicalTrackId, source: 'kw', sourceTrackId: 'blocked', track: blockedTrack, metadataQuality: 1, lastSeenAt: now },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  const raw = snapshots.publish('2026-05-01', 'ready', ['kw'], [ranked])
  const taste = new TasteRepository(() => now, () => `feedback-${++id}`)
  taste.recordFeedback({ type: 'not_interested_track', track: raw.items[0].track })
  const service = new RecommendationService({
    sampler: { run: vi.fn(), close: () => {} } as unknown as CatalogSampler,
    ranker: { rank: () => [] } as unknown as RecommendationRanker,
    snapshots,
    taste,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish: vi.fn(),
    now: () => now,
  })

  expect(service.daily().items).toEqual([])
  expect(snapshots.current('2026-05-01')?.items).toHaveLength(1)
  await service.close()
})

it('projects interested state without mutating the snapshot and publishes feedback invalidation', async() => {
  let id = 0
  const now = Date.UTC(2026, 4, 1, 12)
  const snapshots = new SnapshotRepository(() => now, () => `snapshot-${++id}`)
  const candidate = { id: 'liked', source: 'kw', name: 'Liked', singer: 'Artist' }
  const canonicalTrackId = canonicalizeTrack(candidate)!.canonicalTrackId
  const ranked: RankedRecommendation = {
    canonicalTrackId,
    variant: { canonicalTrackId, source: 'kw', sourceTrackId: 'liked', track: candidate, metadataQuality: 1, lastSeenAt: now },
    bucket: 'new',
    reason: { type: 'exploration', labels: [] },
    score: 1,
  }
  snapshots.publish('2026-05-01', 'ready', ['kw'], [ranked])
  const taste = new TasteRepository(() => now, () => `feedback-${++id}`)
  const publish = vi.fn()
  const service = new RecommendationService({
    sampler: { run: vi.fn(), close: () => {} } as unknown as CatalogSampler,
    ranker: { rank: () => [] } as unknown as RecommendationRanker,
    snapshots,
    taste,
    getTimeZone: () => 'UTC',
    isPlayableProvider: () => true,
    sourcePriority: () => 0,
    publish,
    now: () => now,
  })

  expect(service.daily().items[0].feedback).toEqual({ interested: false, interestedFeedbackId: null })
  const feedback = service.recordFeedback({ type: 'interested_track', track: candidate })
  expect(service.daily().items[0].feedback).toEqual({ interested: true, interestedFeedbackId: feedback.feedbackId })
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
    items: [expect.objectContaining({ feedback: { interested: true, interestedFeedbackId: feedback.feedbackId } })],
  }))
  expect(snapshots.current('2026-05-01')?.items[0].feedback).toBeUndefined()
  await service.close()
})
