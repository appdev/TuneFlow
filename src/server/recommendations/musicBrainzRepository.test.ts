import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, init } from '../db/core/db'
import { SqliteMusicBrainzRepository } from './musicBrainzRepository'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-musicbrainz-'))
  init(root)
})
afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

const track = { id: 'track', source: 'kw', name: 'Song', singer: 'Artist', interval: '03:00' }

describe('SqliteMusicBrainzRepository', () => {
  it('keeps negative cache entries scoped to their endpoint', async() => {
    const requests: string[] = []
    const repository = new SqliteMusicBrainzRepository({
      clientFactory: baseUrl => ({
        getJson: async(pathname: string) => { requests.push(`${baseUrl}${pathname}`); return { recordings: [] } },
      }),
    })

    await repository.matchRecording('https://a.example/ws/2/', track)
    await repository.matchRecording('https://a.example/ws/2/', track)
    await repository.matchRecording('https://b.example/ws/2/', track)
    expect(requests).toHaveLength(2)
  })

  it('caches a high-confidence recording match', async() => {
    let calls = 0
    const repository = new SqliteMusicBrainzRepository({
      clientFactory: () => ({
        getJson: async() => {
          calls += 1
          return { recordings: [{ id: 'recording-id', title: 'Song', score: 99, 'artist-credit': [{ name: 'Artist' }] }] }
        },
      }),
    })

    const first = await repository.matchRecording('https://a.example/ws/2/', track)
    const second = await repository.matchRecording('https://a.example/ws/2/', track)
    expect(first).toMatchObject({ method: 'search', confidence: 0.99, recording: { recordingMbid: 'recording-id' } })
    expect(second).toEqual(first)
    expect(calls).toBe(1)
  })
})
