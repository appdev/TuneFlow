import { describe, expect, it } from 'vitest'
import type { CatalogCandidate } from './catalogRepository'
import { MusicBrainzEnricher } from './musicBrainzEnricher'
import type { TasteSeed } from './tasteRepository'

const seed: TasteSeed = {
  canonicalTrackId: 'seed',
  score: 4,
  playCount: 1,
  completedCount: 1,
  earlySkipCount: 0,
  lastPlayedAt: 1,
  track: { id: 'seed', source: 'kw', name: 'Seed Song', singer: 'Seed Artist' },
}

const candidate: CatalogCandidate = {
  canonical: {
    canonicalTrackId: 'candidate',
    normalizedTitle: 'related song',
    normalizedArtists: ['related artist'],
    normalizedAlbum: 'album',
    versionMarker: '',
  },
  variants: [{
    canonicalTrackId: 'candidate',
    source: 'kw',
    sourceTrackId: 'candidate',
    track: { id: 'candidate', source: 'kw', name: 'Related Song', singer: 'Related Artist' },
    metadataQuality: 1,
    lastSeenAt: 1,
  }],
  tags: [],
}

describe('MusicBrainzEnricher', () => {
  it('maps related metadata only onto an existing playable catalog candidate', async() => {
    const enricher = new MusicBrainzEnricher({
      matchRecording: async() => ({
        method: 'search',
        confidence: 0.99,
        recording: { recordingMbid: 'seed-mbid', title: 'Seed Song', artists: ['Seed Artist'], durationMs: null, releaseGroupMbids: [], workMbids: [], firstReleaseDate: null },
      }),
      relatedRecordings: async() => [
        { recordingMbid: 'related-mbid', title: 'Related Song', artists: ['Related Artist'], durationMs: null, releaseGroupMbids: [], workMbids: [], firstReleaseDate: null },
        { recordingMbid: 'missing-mbid', title: 'Missing Song', artists: ['Missing Artist'], durationMs: null, releaseGroupMbids: [], workMbids: [], firstReleaseDate: null },
      ],
    })

    const result = await enricher.enrich('https://music.example/ws/2/', [seed], [candidate])
    expect([...result.evidence.keys()]).toEqual(['candidate'])
    expect(result.evidence.get('candidate')?.reason.type).toBe('artist_affinity')
  })

  it('never returns MusicBrainz-only candidates', async() => {
    const enricher = new MusicBrainzEnricher({
      matchRecording: async() => null,
      relatedRecordings: async() => [],
    })
    expect((await enricher.enrich('https://music.example/ws/2/', [seed], [])).evidence.size).toBe(0)
  })
})
