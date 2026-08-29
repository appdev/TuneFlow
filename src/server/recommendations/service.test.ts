import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { close, init } from '../db/core/db'
import { CatalogRepository } from './catalogRepository'
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

  expect(service.daily()).toEqual(previous)
  expect(service.status()).toMatchObject({ status: 'ready', version: 1, lastErrorCode: 'UPSTREAM_FAILED' })
  expect(publish).toHaveBeenCalledWith(previous)
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
