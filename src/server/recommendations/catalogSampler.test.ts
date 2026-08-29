import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close, init } from '../db/core/db'
import type { ProviderSummary } from '../tuneFlowSdk'
import { CatalogRepository } from './catalogRepository'
import { CatalogSampler } from './catalogSampler'
import { recommendationPolicy } from './policy'
import { RelationIndex } from './relationIndex'

const DAY = 86_400_000
const NOW = 30 * DAY
let root: string

const provider = (id: string, leaderboards = false): ProviderSummary => ({
  id,
  name: id.toUpperCase(),
  searchKinds: ['track', 'playlist'],
  leaderboards,
  albumDetail: false,
  playlistDiscovery: { tags: true, browse: true, detail: true },
})

const track = (source: string, id: string) => ({ id, source, name: `Song ${source} ${id}`, singer: `Artist ${source} ${id}`, interval: '03:00' })

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-sampler-'))
  init(root)
})

afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

describe('CatalogSampler', () => {
  it('filters unplayable providers and isolates a failed source without replacing its old playlist', async() => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'bad',
      playlistId: 'list',
      name: 'Old',
      description: '',
      labels: [],
      sampledAt: NOW - 8 * DAY,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [track('bad', 'old')],
    })
    const detail = vi.fn(async({ source, playlistId }: { source: string, playlistId: string }) => {
      if (source === 'bad') throw Object.assign(new Error('provider failed'), { code: 'UPSTREAM_FAILED' })
      return {
        source,
        page: 1,
        limit: 1,
        total: 1,
        hasMore: false,
        playlist: { id: playlistId, kind: 'playlist' as const, name: 'Fresh', source },
        tracks: [track(source, 'fresh')],
      }
    })
    const sampler = new CatalogSampler(catalog, new RelationIndex(catalog, () => NOW), {
      providers: () => [provider('bad'), provider('good'), provider('disabled')],
      isPlayableProvider: source => source !== 'disabled',
      now: () => NOW,
      getTags: async source => ({ source, sorts: [{ id: 'hot', name: 'Hot' }], hotTags: [{ id: 'tag', name: 'Rock' }], groups: [] }),
      browse: async({ source }) => ({ source, page: 1, limit: 1, total: 1, hasMore: false, list: [{ id: 'list', kind: 'playlist', name: 'List', source }] }),
      detail,
    })

    const result = await sampler.run('daily')

    expect(result).toEqual({ sampled: 1, failedSources: ['bad:UPSTREAM_FAILED'], eligibleSources: ['bad', 'good'], sourceCoverage: ['bad', 'good'] })
    expect(detail.mock.calls.map(([input]) => input.source)).toEqual(['bad', 'good'])
    expect(catalog.candidates(NOW).map(candidate => candidate.variants[0].track.id).sort()).toEqual(['fresh', 'old'])
  })

  it('deduplicates paged tracks and stops at the 100-track playlist budget', async() => {
    const catalog = new CatalogRepository()
    const detail = vi.fn(async({ source, playlistId, page }: { source: string, playlistId: string, page: number }) => ({
      source,
      page,
      limit: 70,
      total: 140,
      hasMore: true,
      playlist: { id: playlistId, kind: 'playlist' as const, name: 'Paged', source },
      tracks: Array.from({ length: 70 }, (_, index) => track(source, String(index + (page - 1) * 60))),
    }))
    const sampler = new CatalogSampler(catalog, new RelationIndex(catalog, () => NOW), {
      providers: () => [provider('good')],
      isPlayableProvider: () => true,
      now: () => NOW,
      getTags: async source => ({ source, sorts: [], hotTags: [], groups: [] }),
      browse: async({ source }) => ({ source, page: 1, limit: 1, total: 1, hasMore: false, list: [{ id: 'paged', kind: 'playlist', name: 'Paged', source }] }),
      detail,
    })

    expect(await sampler.run('bootstrap')).toMatchObject({ sampled: 1, failedSources: [] })
    expect(detail).toHaveBeenCalledTimes(2)
    expect(catalog.candidates(NOW)).toHaveLength(recommendationPolicy.maxTracksPerPlaylist)
  })

  it('keeps leaderboard exploration inside the per-source daily playlist budget', async() => {
    const catalog = new CatalogRepository()
    const tags = Array.from({ length: 12 }, (_, index) => ({ id: `tag-${index}`, name: `Tag ${index}` }))
    const sampler = new CatalogSampler(catalog, new RelationIndex(catalog, () => NOW), {
      providers: () => [provider('good', true)],
      isPlayableProvider: () => true,
      now: () => NOW,
      getTags: async source => ({ source, sorts: [], hotTags: tags, groups: [] }),
      browse: async({ source, tagId }) => ({ source, page: 1, limit: 1, total: 1, hasMore: false, list: [{ id: tagId, kind: 'playlist', name: tagId, source }] }),
      detail: async({ source, playlistId, page }) => ({ source, page, limit: 1, total: 1, hasMore: false, playlist: { id: playlistId, kind: 'playlist', name: playlistId, source }, tracks: [track(source, playlistId)] }),
      getBoards: async source => ({ source, list: Array.from({ length: 2 }, (_, index) => ({ id: `board-${index}`, providerId: `board-${index}`, name: `Board ${index}`, source })) }),
      getBoardTracks: async(source, boardId, page) => ({ source, page, limit: 1, total: 1, list: [track(source, boardId)] }),
    })

    const result = await sampler.run('daily')
    expect(result.sampled).toBeLessThanOrEqual(recommendationPolicy.dailyRefreshPlaylistsPerSource)
  })

  it('does not refetch a playlist before the seven-day refresh interval', async() => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'good',
      playlistId: 'recent',
      name: 'Recent',
      description: '',
      labels: [],
      sampledAt: NOW - DAY,
      expiresAt: NOW + 29 * DAY,
      reliability: 1,
      tracks: [track('good', 'old')],
    })
    const detail = vi.fn(async({ source, playlistId, page }: { source: string, playlistId: string, page: number }) => ({
      source,
      page,
      limit: 1,
      total: 1,
      hasMore: false,
      playlist: { id: playlistId, kind: 'playlist' as const, name: 'Recent', source },
      tracks: [track(source, 'new')],
    }))
    const sampler = new CatalogSampler(catalog, new RelationIndex(catalog, () => NOW), {
      providers: () => [provider('good')],
      isPlayableProvider: () => true,
      now: () => NOW,
      getTags: async source => ({ source, sorts: [], hotTags: [], groups: [] }),
      browse: async({ source }) => ({ source, page: 1, limit: 1, total: 1, hasMore: false, list: [{ id: 'recent', kind: 'playlist', name: 'Recent', source }] }),
      detail,
    })

    expect(await sampler.run('daily')).toMatchObject({ sampled: 0 })
    expect(detail).not.toHaveBeenCalled()
  })
})
