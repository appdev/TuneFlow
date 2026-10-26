import { describe, expect, it } from 'vitest'
import { canonicalizeTrack, normalizeArtistIdentity } from './identity'

describe('recommendation canonical identity', () => {
  it('deduplicates provider ids while preserving edition markers', () => {
    const first = canonicalizeTrack({ id: 'one', source: 'kw', name: 'Example Song', singer: 'Artist feat. Guest' })
    const second = canonicalizeTrack({ id: 'two', source: 'wy', name: 'Example Song', singer: 'Guest / Artist' })
    const live = canonicalizeTrack({ id: 'three', source: 'tx', name: 'Example Song (Live)', singer: 'Artist & Guest' })

    expect(first?.canonicalTrackId).toBe(second?.canonicalTrackId)
    expect(live?.canonicalTrackId).not.toBe(first?.canonicalTrackId)
    expect(live?.versionMarker).toBe('live')
  })

  it('normalizes artist order and rejects incomplete tracks', () => {
    expect(normalizeArtistIdentity(' B、A & B ')).toEqual(['a', 'b'])
    expect(canonicalizeTrack({ id: 'missing-singer', source: 'kw', name: 'Song' })).toBeNull()
  })
})
