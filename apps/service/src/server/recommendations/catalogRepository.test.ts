import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, getDB, init } from '../db/core/db'
import { CatalogRepository } from './catalogRepository'

const DAY = 86_400_000
const NOW = 50 * DAY
let root: string

const track = (id: string, source = 'kw', extra: Record<string, unknown> = {}) => ({
  id,
  source,
  name: 'Shared Song',
  singer: 'Artist feat. Guest',
  interval: '03:00',
  meta: { albumName: 'Album' },
  ...extra,
})

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-catalog-'))
  init(root)
})

afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

describe('CatalogRepository', () => {
  it('deduplicates canonical tracks across providers while retaining safe variants', () => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'kw-list',
      name: 'KW',
      description: '',
      labels: [],
      sampledAt: NOW,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [track('kw-id', 'kw', { musicUrl: 'https://secret.invalid/audio', headers: { Authorization: 'secret' }, nested: { token: 'secret', safe: 'kept' } })],
    })
    catalog.replacePlaylist({
      source: 'wy',
      playlistId: 'wy-list',
      name: 'WY',
      description: '',
      labels: [],
      sampledAt: NOW,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [{ ...track('wy-id', 'wy'), singer: 'Guest / Artist' }],
    })

    const candidates = catalog.candidates(NOW)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].variants.map(variant => variant.source).sort()).toEqual(['kw', 'wy'])
    expect(candidates[0].variants.find(variant => variant.source === 'kw')?.track).toMatchObject({ nested: { safe: 'kept' } })
    expect(JSON.stringify(candidates)).not.toContain('secret')
  })

  it('rolls back a failed replacement and preserves the previous complete playlist', () => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'stable',
      name: 'Stable',
      description: '',
      labels: [],
      sampledAt: NOW,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [track('old')],
    })
    const previous = catalog.candidates(NOW)

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'stable',
      name: 'Broken',
      description: '',
      labels: [],
      sampledAt: NOW + 1,
      expiresAt: NOW + DAY,
      reliability: 1,
      tracks: [track('new', 'kw', { nested: { a: { b: { c: cyclic } } } })],
    })).toThrow()

    expect(catalog.candidates(NOW)).toEqual(previous)
    expect(getDB().prepare('SELECT name FROM recommendation_catalog_playlist WHERE playlist_key=?').get('kw:stable')).toEqual({ name: 'Stable' })
  })

  it('removes expired playlist membership from candidate retrieval', () => {
    const catalog = new CatalogRepository()
    catalog.replacePlaylist({
      source: 'kw',
      playlistId: 'expired',
      name: 'Expired',
      description: '',
      labels: [],
      sampledAt: NOW - 2 * DAY,
      expiresAt: NOW - 1,
      reliability: 1,
      tracks: [track('old')],
    })

    const affected = catalog.expirePlaylists(NOW)
    expect(affected.size).toBe(1)
    expect(catalog.candidates(NOW)).toEqual([])
    expect(getDB().prepare('SELECT COUNT(*) AS count FROM recommendation_catalog_member').get()).toEqual({ count: 0 })
  })
})
