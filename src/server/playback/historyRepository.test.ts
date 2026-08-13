import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, init } from '../db/core/db'
import { PlaybackHistoryRepository } from './historyRepository'

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
  it('moves a replayed track to the front and replaces its metadata', () => {
    const times = [1000, 2000, 3000]
    const history = new PlaybackHistoryRepository(() => times.shift()!)

    history.record({ id: 'same', source: 'kw', name: 'Old' })
    history.record({ id: 'other', source: 'wy', name: 'Other' })
    history.record({ id: 'same', source: 'kw', name: 'New', providerOnly: { albumId: 'a1' } })

    expect(history.list()).toEqual([
      {
        track: { id: 'same', source: 'kw', name: 'New', providerOnly: { albumId: 'a1' } },
        playedAt: 3000,
      },
      { track: { id: 'other', source: 'wy', name: 'Other' }, playedAt: 2000 },
    ])
  })

  it('retains exactly the newest 50 distinct tracks', () => {
    let now = 0
    const history = new PlaybackHistoryRepository(() => ++now)

    for (let index = 0; index <= 50; index++) {
      history.record({ id: `track-${index}`, source: 'kw', name: `Track ${index}` })
    }

    const entries = history.list()
    expect(entries).toHaveLength(50)
    expect(entries[0].track.id).toBe('track-50')
    expect(entries.at(-1)?.track.id).toBe('track-1')
    expect(entries.some(entry => entry.track.id === 'track-0')).toBe(false)
  })

  it('persists entries when the database is reopened', () => {
    const history = new PlaybackHistoryRepository(() => 1234)
    history.record({ id: 'persisted', source: 'tx', name: 'Persisted' })

    close()
    expect(init(storageRoot)).toBe(true)

    expect(new PlaybackHistoryRepository().list()).toEqual([
      {
        track: { id: 'persisted', source: 'tx', name: 'Persisted' },
        playedAt: 1234,
      },
    ])
  })
})
