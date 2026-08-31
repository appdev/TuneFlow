import type { CatalogCandidate } from './catalogRepository'
import { normalizeArtistIdentity, normalizeLabel } from './identity'
import type { TasteSeed } from './tasteRepository'
import type { MusicBrainzRecording, MusicBrainzRecordingMatch, RecommendationReason } from './types'

export interface MusicBrainzLookup {
  matchRecording: (baseUrl: string, track: NonNullable<TasteSeed['track']>) => Promise<MusicBrainzRecordingMatch | null>
  relatedRecordings: (baseUrl: string, recordingMbids: readonly string[]) => Promise<MusicBrainzRecording[]>
}

export interface MusicBrainzCandidateEvidence {
  score: number
  reason: RecommendationReason
}

export interface MusicBrainzEnrichment {
  evidence: Map<string, MusicBrainzCandidateEvidence>
  matchedSeeds: number
  errorCode: string | null
}

const candidateKey = (title: string, artists: readonly string[]): string =>
  `${normalizeLabel(title)}\u001f${[...artists].map(normalizeLabel).filter(Boolean).sort().join('\u001f')}`

const errorCode = (error: unknown): string => typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string'
  ? `MUSICBRAINZ_${error.code.toUpperCase()}`
  : 'MUSICBRAINZ_UNAVAILABLE'

export class MusicBrainzEnricher {
  constructor(private readonly lookup: MusicBrainzLookup) {}

  async enrich(baseUrl: string, seeds: readonly TasteSeed[], candidates: readonly CatalogCandidate[]): Promise<MusicBrainzEnrichment> {
    if (baseUrl === '' || candidates.length === 0) return { evidence: new Map(), matchedSeeds: 0, errorCode: null }
    const matches: MusicBrainzRecordingMatch[] = []
    let failure: string | null = null
    for (const seed of seeds.filter(item => item.track != null).slice(0, 10)) {
      try {
        const match = await this.lookup.matchRecording(baseUrl, seed.track!)
        if (match != null) matches.push(match)
      } catch (error) {
        failure ??= errorCode(error)
      }
    }
    if (matches.length === 0) return { evidence: new Map(), matchedSeeds: 0, errorCode: failure }

    let related: MusicBrainzRecording[] = []
    try {
      related = await this.lookup.relatedRecordings(baseUrl, matches.map(item => item.recording.recordingMbid))
    } catch (error) {
      failure ??= errorCode(error)
    }
    const catalogByKey = new Map<string, CatalogCandidate[]>()
    for (const candidate of candidates) {
      const key = candidateKey(candidate.canonical.normalizedTitle, candidate.canonical.normalizedArtists)
      catalogByKey.set(key, [...(catalogByKey.get(key) ?? []), candidate])
    }
    const contributions = new Map<string, number[]>()
    for (const recording of related) {
      const key = candidateKey(recording.title, normalizeArtistIdentity(recording.artists.join(', ')))
      const mapped = catalogByKey.get(key) ?? []
      if (mapped.length !== 1) continue
      const id = mapped[0].canonical.canonicalTrackId
      contributions.set(id, [...(contributions.get(id) ?? []), 0.35])
    }
    const evidence = new Map<string, MusicBrainzCandidateEvidence>()
    for (const [id, values] of contributions) {
      const score = 1 - Math.exp(-values.reduce((sum, value) => sum + value, 0))
      const candidate = candidates.find(item => item.canonical.canonicalTrackId === id)!
      evidence.set(id, {
        score,
        reason: candidate.canonical.normalizedArtists.length > 0
          ? { type: 'artist_affinity', labels: candidate.canonical.normalizedArtists.slice(0, 2) }
          : { type: 'album_affinity', labels: [candidate.canonical.normalizedAlbum].filter(Boolean) },
      })
    }
    return { evidence, matchedSeeds: matches.length, errorCode: failure }
  }
}
