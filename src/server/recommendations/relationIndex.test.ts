import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, init } from '../db/core/db'
import { CatalogRepository } from './catalogRepository'
import { RelationIndex } from './relationIndex'

const DAY = 86_400_000
const NOW = 20 * DAY
let root: string

const track = (id: string) => ({ id, source: 'kw', name: `Song ${id}`, singer: `Artist ${id}`, interval: '03:00' })

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-relations-'))
  init(root)
})

afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

const replace = (catalog: CatalogRepository, playlistId: string, ids: string[], labels: string[] = []) => catalog.replacePlaylist({
  source: 'kw',
  playlistId,
  name: labels.join(' '),
  description: '',
  labels,
  sampledAt: NOW,
  expiresAt: NOW + DAY,
  reliability: 1,
  tracks: ids.map(track),
})

describe('RelationIndex', () => {
  it('normalizes co-occurrence popularity and keeps deterministic neighbor ordering', () => {
    const catalog = new CatalogRepository()
    replace(catalog, 'one', ['seed', 'common', 'single'])
    replace(catalog, 'two', ['seed', 'common', 'other'])
    const seedId = catalog.candidates(NOW).find(candidate => candidate.canonical.normalizedTitle === 'song seed')!.canonical.canonicalTrackId

    new RelationIndex(catalog, () => NOW).rebuild(new Set([seedId]))
    const neighbors = catalog.neighbors([seedId]).get(seedId)!

    expect(neighbors).toHaveLength(3)
    expect(neighbors[0].candidateId).toBe(catalog.candidates(NOW).find(candidate => candidate.canonical.normalizedTitle === 'song common')!.canonical.canonicalTrackId)
    expect(neighbors[0].similarity).toBeGreaterThan(neighbors[1].similarity)
    expect(neighbors.slice(1).map(item => item.candidateId)).toEqual([...neighbors.slice(1).map(item => item.candidateId)].sort())
  })

  it('requires three independent playlists before exposing a weak tag', () => {
    const catalog = new CatalogRepository()
    const relations = new RelationIndex(catalog, () => NOW)
    replace(catalog, 'one', ['seed', 'one'], ['rock'])
    replace(catalog, 'two', ['seed', 'two'], ['摇滚'])
    const seedId = catalog.candidates(NOW).find(candidate => candidate.canonical.normalizedTitle === 'song seed')!.canonical.canonicalTrackId

    relations.rebuild(new Set([seedId]))
    expect(catalog.candidates(NOW).find(candidate => candidate.canonical.canonicalTrackId === seedId)?.tags).toEqual([])

    replace(catalog, 'three', ['seed', 'three'], ['搖滾'])
    relations.rebuild(new Set([seedId]))
    expect(catalog.candidates(NOW).find(candidate => candidate.canonical.canonicalTrackId === seedId)?.tags)
      .toEqual([expect.objectContaining({ kind: 'genre', value: 'rock', support: 3 })])
  })

  it('truncates each seed to the deterministic 200-neighbor policy limit', () => {
    const catalog = new CatalogRepository()
    replace(catalog, 'large', ['seed', ...Array.from({ length: 205 }, (_, index) => `candidate-${index}`)])
    const seedId = catalog.candidates(NOW).find(candidate => candidate.canonical.normalizedTitle === 'song seed')!.canonical.canonicalTrackId

    new RelationIndex(catalog, () => NOW).rebuild(new Set([seedId]))
    const neighbors = catalog.neighbors([seedId]).get(seedId)!

    expect(neighbors).toHaveLength(200)
    expect(neighbors.map(item => item.candidateId)).toEqual([...neighbors.map(item => item.candidateId)].sort())
  })
})
