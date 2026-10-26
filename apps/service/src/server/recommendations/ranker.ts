import type { CatalogRepository } from './catalogRepository'
import { normalizeLabel } from './identity'
import { recommendationPolicy, recommendationWeights } from './policy'
import { toTasteTrackPattern, type TasteRepository } from './tasteRepository'
import type { RankedRecommendation, RecommendationReason, TrackVariant } from './types'
import type { MusicBrainzCandidateEvidence } from './musicBrainzEnricher'

export interface RankRecommendationsInput {
  exposedToday?: ReadonlySet<string>
  excludedCanonicalIds?: ReadonlySet<string>
  musicBrainzEvidence?: ReadonlyMap<string, MusicBrainzCandidateEvidence>
  isPlayableProvider: (source: string) => boolean
  sourcePriority: (source: string) => number
  now: number
}

const albumName = (variant: TrackVariant): string => {
  if (typeof variant.track.albumName === 'string') return normalizeLabel(variant.track.albumName)
  const meta = variant.track.meta
  return typeof meta === 'object' && meta != null && typeof (meta as Record<string, unknown>).albumName === 'string'
    ? normalizeLabel((meta as Record<string, unknown>).albumName as string)
    : ''
}

export class RecommendationRanker {
  constructor(private readonly catalog: CatalogRepository, private readonly taste: TasteRepository) {}

  catalogCandidates(now?: number) { return this.catalog.candidates(now) }

  rank(input: RankRecommendationsInput): RankedRecommendation[] {
    const candidates = this.rankCandidates(input)
    const fresh = candidates.filter(item => item.bucket === 'new')
    const familiar = candidates.filter(item => item.bucket === 'familiar')
    const freshTarget = Math.min(recommendationPolicy.newTarget + Math.max(0, recommendationPolicy.familiarTarget - familiar.length), fresh.length)
    return this.diversify(this.reserveExploration(fresh, freshTarget), familiar)
  }

  rankCandidates(input: RankRecommendationsInput): RankedRecommendation[] {
    const facts = this.taste.facts()
    const artistScores = this.taste.artistScores()
    const exclusions = this.taste.exclusions()
    const seeds = this.taste.seeds(50)
    const catalogCandidates = this.catalog.candidates(input.now)
    const catalogById = new Map(catalogCandidates.map(candidate => [candidate.canonical.canonicalTrackId, candidate]))
    const albumScores = this.taste.albumScores()
    const tagScores = new Map<string, number>()
    for (const seed of seeds) {
      const candidate = catalogById.get(seed.canonicalTrackId)
      if (candidate == null) continue
      const seedWeight = Math.max(0, seed.score)
      for (const tag of candidate.tags) {
        const key = `${tag.kind}:${tag.value}`
        tagScores.set(key, (tagScores.get(key) ?? 0) + seedWeight * tag.confidence)
      }
    }
    const neighbors = this.catalog.neighbors(seeds.map(seed => seed.canonicalTrackId))
    const relationContributions = new Map<string, number[]>()
    for (const seed of seeds) {
      const seedWeight = Math.max(0, seed.score)
      for (const neighbor of neighbors.get(seed.canonicalTrackId) ?? []) {
        relationContributions.set(neighbor.candidateId, [
          ...(relationContributions.get(neighbor.candidateId) ?? []),
          neighbor.similarity * seedWeight,
        ])
      }
    }
    const candidates: RankedRecommendation[] = []
    for (const candidate of catalogCandidates) {
      const id = candidate.canonical.canonicalTrackId
      const excludedCanonicalIds = input.excludedCanonicalIds ?? input.exposedToday ?? new Set<string>()
      if (excludedCanonicalIds.has(id) || exclusions.tracks.has(id) || exclusions.titles.has(candidate.canonical.normalizedTitle)) continue
      if (candidate.canonical.normalizedArtists.some(artist => exclusions.artists.has(artist))) continue
      if (exclusions.trackPatterns.has(toTasteTrackPattern(candidate.canonical.normalizedTitle, candidate.canonical.normalizedArtists))) continue
      const variants = candidate.variants.filter(variant => input.isPlayableProvider(variant.source))
      if (variants.length === 0) continue
      variants.sort((a, b) => b.metadataQuality - a.metadataQuality || input.sourcePriority(a.source) - input.sourcePriority(b.source) || b.lastSeenAt - a.lastSeenAt || a.source.localeCompare(b.source))
      const variant = variants[0]
      const fact = facts.get(id)
      const familiar = fact != null
      if (familiar && ((fact.lastPlayedAt != null && input.now - fact.lastPlayedAt < 86_400_000) || fact.earlySkipCount > fact.completedCount + 1)) continue
      const relationValues = relationContributions.get(id) ?? []
      const localRelation = 1 - Math.exp(-relationValues.reduce((sum, value) => sum + Math.max(0, value), 0))
      const musicBrainz = input.musicBrainzEvidence?.get(id)
      const relation = 1 - Math.exp(-(localRelation + Math.max(0, musicBrainz?.score ?? 0)))
      const artistAffinity = Math.min(1, candidate.canonical.normalizedArtists.reduce((sum, artist) => sum + Math.max(0, artistScores.get(artist) ?? 0), 0) / 5)
      const albumAffinity = Math.min(1, Math.max(0, albumScores.get(candidate.canonical.normalizedAlbum) ?? 0) / 5)
      const tagAffinity = Math.min(1, candidate.tags.reduce((sum, tag) => sum + tag.confidence * Math.max(0, tagScores.get(`${tag.kind}:${tag.value}`) ?? 0), 0) / 5)
      const exploration = relation === 0 && artistAffinity === 0 && albumAffinity === 0 && tagAffinity === 0 ? 1 : 0
      const score = familiar
        ? Math.max(0, fact.score) + Math.min(1, fact.completedCount / 5)
        : recommendationWeights.relation * relation + recommendationWeights.artistAlbum * Math.max(artistAffinity, albumAffinity) + recommendationWeights.tag * tagAffinity + recommendationWeights.exploration * exploration + recommendationWeights.variant * variant.metadataQuality
      const reason: RecommendationReason = familiar
        ? { type: 'familiar_replay', labels: [] }
        : musicBrainz != null && musicBrainz.score >= localRelation ? musicBrainz.reason
          : relation > 0 ? { type: 'playlist_cooccurrence', labels: [] }
            : artistAffinity > 0 ? { type: 'artist_affinity', labels: candidate.canonical.normalizedArtists.slice(0, 2) }
              : albumAffinity > 0 ? { type: 'album_affinity', labels: [candidate.canonical.normalizedAlbum] }
                : tagAffinity > 0 ? { type: 'tag_affinity', labels: candidate.tags.filter(tag => (tagScores.get(`${tag.kind}:${tag.value}`) ?? 0) > 0).slice(0, 2).map(tag => tag.value) }
                  : { type: 'exploration', labels: [] }
      candidates.push({ canonicalTrackId: id, variant, bucket: familiar ? 'familiar' : 'new', reason, score })
    }
    const fresh = candidates.filter(item => item.bucket === 'new').sort((a, b) => b.score - a.score || a.canonicalTrackId.localeCompare(b.canonicalTrackId))
    const familiar = candidates.filter(item => item.bucket === 'familiar').sort((a, b) => b.score - a.score || a.canonicalTrackId.localeCompare(b.canonicalTrackId))
    return [...fresh, ...familiar]
  }

  private reserveExploration(fresh: RankedRecommendation[], target: number): RankedRecommendation[] {
    const exploration = fresh.filter(item => item.reason.type === 'exploration')
    const personalized = fresh.filter(item => item.reason.type !== 'exploration')
    const explorationTarget = Math.min(exploration.length, Math.ceil(target * recommendationPolicy.explorationRatio))
    const personalizedTarget = Math.min(personalized.length, target - explorationTarget)
    const selected = [...personalized.slice(0, personalizedTarget), ...exploration.slice(0, explorationTarget)]
    const selectedIds = new Set(selected.map(item => item.canonicalTrackId))
    const remainingExploration = exploration.filter(item => !selectedIds.has(item.canonicalTrackId))
    const remainingPersonalized = personalized.filter(item => !selectedIds.has(item.canonicalTrackId))
    const fillCount = Math.max(0, target - selected.length)
    return [...selected, ...remainingExploration.slice(0, fillCount), ...remainingExploration.slice(fillCount), ...remainingPersonalized]
  }

  private diversify(fresh: RankedRecommendation[], familiar: RankedRecommendation[]): RankedRecommendation[] {
    const freshTarget = Math.min(recommendationPolicy.newTarget + Math.max(0, recommendationPolicy.familiarTarget - familiar.length), fresh.length)
    const familiarTarget = Math.min(recommendationPolicy.familiarTarget, familiar.length)
    const queues = { new: fresh.slice(0, Math.max(freshTarget * 3, freshTarget)), familiar: familiar.slice(0, Math.max(familiarTarget * 3, familiarTarget)) }
    const desired: Array<'new' | 'familiar'> = []
    for (let index = 0; index < freshTarget + familiarTarget; index += 1) desired.push(index % 3 === 2 && familiarTarget > desired.filter(item => item === 'familiar').length ? 'familiar' : 'new')
    while (desired.filter(item => item === 'familiar').length < familiarTarget) desired[desired.lastIndexOf('new')] = 'familiar'
    const result: RankedRecommendation[] = []
    const artistCounts = new Map<string, number>()
    const albumCounts = new Map<string, number>()
    for (const bucket of desired) {
      const primary = queues[bucket]
      const fallback = queues[bucket === 'new' ? 'familiar' : 'new']
      const take = (queue: RankedRecommendation[]): RankedRecommendation | undefined => {
        const index = queue.findIndex(item => {
          const artists = item.variant.track.singer.split(/[,&、，/]/).map(normalizeLabel).filter(Boolean)
          const album = albumName(item.variant)
          const previousArtist = result.at(-1)?.variant.track.singer == null ? '' : normalizeLabel(result.at(-1)!.variant.track.singer)
          return artists.every(artist => (artistCounts.get(artist) ?? 0) < recommendationPolicy.artistLimit) &&
            (album === '' || (albumCounts.get(album) ?? 0) < recommendationPolicy.albumLimit) &&
            !artists.includes(previousArtist)
        })
        return index < 0 ? undefined : queue.splice(index, 1)[0]
      }
      const item = take(primary) ?? take(fallback)
      if (item == null) continue
      result.push(item)
      for (const artist of item.variant.track.singer.split(/[,&、，/]/).map(normalizeLabel).filter(Boolean)) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1)
      const album = albumName(item.variant)
      if (album !== '') albumCounts.set(album, (albumCounts.get(album) ?? 0) + 1)
    }
    return result.slice(0, recommendationPolicy.targetSize)
  }
}
