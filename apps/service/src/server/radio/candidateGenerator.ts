import { canonicalizeTrack, normalizeLabel, toTrackVariant } from '../recommendations/identity'
import type { RecommendationRanker } from '../recommendations/ranker'
import type { RankedRecommendation, RecommendationItem, RecommendationTrack } from '../recommendations/types'
import type { AIProfile, RadioSessionItem } from './types'
import { radioPolicy } from './policy'

export interface RadioCandidateContext {
  currentTrack: RecommendationTrack | null
  queuedCanonicalIds: Set<string>
  exposedCanonicalIds: Set<string>
  recentSessionItems: RadioSessionItem[]
  profile: AIProfile | null
  fallbackItems?: RecommendationItem[]
  isPlayableProvider: (source: string) => boolean
  sourcePriority: (source: string) => number
  now: number
  localHour?: number
  limit: number
}

const album = (item: RankedRecommendation): string => {
  const direct = item.variant.track.albumName
  if (typeof direct === 'string') return normalizeLabel(direct)
  const meta = item.variant.track.meta
  return typeof meta === 'object' && meta != null && typeof (meta as Record<string, unknown>).albumName === 'string' ? normalizeLabel((meta as Record<string, unknown>).albumName as string) : ''
}
const artists = (item: RankedRecommendation): string[] => canonicalizeTrack(item.variant.track)?.normalizedArtists ?? []

export class RadioCandidateGenerator {
  constructor(private readonly ranker: RecommendationRanker) {}

  pool(context: RadioCandidateContext): RankedRecommendation[] {
    const excluded = new Set([...context.queuedCanonicalIds, ...context.exposedCanonicalIds])
    let candidates = this.ranker.rankCandidates({ excludedCanonicalIds: excluded, isPlayableProvider: context.isPlayableProvider, sourcePriority: context.sourcePriority, now: context.now })
      .filter(item => !excluded.has(item.canonicalTrackId) && context.isPlayableProvider(item.variant.source))
      .map(item => ({ ...item, score: item.score + this.contextScore(item, context) }))
      .sort((left, right) => right.score - left.score || left.canonicalTrackId.localeCompare(right.canonicalTrackId))
    if (candidates.length < context.limit && context.fallbackItems != null) {
      const known = new Set([...excluded, ...candidates.map(item => item.canonicalTrackId)])
      for (const item of context.fallbackItems) {
        if (known.has(item.canonicalTrackId) || !context.isPlayableProvider(item.track.source)) continue
        const variant = toTrackVariant(item.track, context.now)
        if (variant == null) continue
        candidates.push({ canonicalTrackId: item.canonicalTrackId, variant, bucket: item.bucket, reason: item.reason, score: 0 })
        known.add(item.canonicalTrackId)
      }
    }
    candidates = candidates.slice(0, radioPolicy.maxCandidateCount)
    return candidates
  }

  select(candidates: RankedRecommendation[], limit: number): RankedRecommendation[] {
    return this.diversify(candidates, Math.min(limit, radioPolicy.batchSize))
  }

  generate(context: RadioCandidateContext): RankedRecommendation[] {
    return this.select(this.pool(context), context.limit)
  }

  private contextScore(item: RankedRecommendation, context: RadioCandidateContext): number {
    let score = 0
    const current = context.currentTrack == null ? null : canonicalizeTrack(context.currentTrack)
    const itemCanonical = canonicalizeTrack(item.variant.track)
    if (current != null && itemCanonical != null) {
      if (itemCanonical.normalizedArtists.some(artist => current.normalizedArtists.includes(artist))) score += 0.25
      if (itemCanonical.normalizedAlbum !== '' && itemCanonical.normalizedAlbum === current.normalizedAlbum) score += 0.15
    }
    const recent = context.recentSessionItems.slice(-3)
    const itemArtists = artists(item)
    for (const event of recent) {
      const eventArtists = canonicalizeTrack(event.track)?.normalizedArtists ?? []
      if (eventArtists.some(artist => itemArtists.includes(artist))) score += event.state === 'completed' ? 0.08 : event.state === 'skipped' ? -0.25 : 0
    }
    const localHour = context.localHour ?? new Date(context.now).getUTCHours()
    const time = context.profile?.timePreferences.find(preference => preference.startHour <= preference.endHour
      ? localHour >= preference.startHour && localHour < preference.endHour
      : localHour >= preference.startHour || localHour < preference.endHour)
    if (time != null) {
      if (itemArtists.some(artist => time.artists.map(normalizeLabel).includes(artist))) score += 0.1 * time.confidence
      if (item.reason.labels.some(label => time.genres.map(normalizeLabel).includes(normalizeLabel(label)))) score += 0.1 * time.confidence
    }
    return score
  }

  private diversify(candidates: RankedRecommendation[], limit: number): RankedRecommendation[] {
    const result: RankedRecommendation[] = []
    const remaining = [...candidates]
    while (result.length < limit && remaining.length > 0) {
      let index = remaining.findIndex(item => {
        const currentArtists = artists(item)
        const recentArtists = result.slice(-radioPolicy.artistGap).flatMap(artists)
        const currentAlbum = album(item)
        const recentAlbums = result.slice(-radioPolicy.albumGap).map(album)
        return !currentArtists.some(artist => recentArtists.includes(artist)) && (currentAlbum === '' || !recentAlbums.includes(currentAlbum))
      })
      if (index < 0) index = 0
      result.push(remaining.splice(index, 1)[0])
    }
    if (result.length === limit && !result.some(item => item.reason.type === 'exploration')) {
      const exploration = candidates.find(item => item.reason.type === 'exploration' && !result.some(selected => selected.canonicalTrackId === item.canonicalTrackId))
      if (exploration != null) result[result.length - 1] = exploration
    }
    return result
  }
}
