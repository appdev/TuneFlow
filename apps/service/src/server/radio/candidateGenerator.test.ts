import { describe, expect, it } from 'vitest'
import type { RecommendationRanker } from '../recommendations/ranker'
import type { RankedRecommendation } from '../recommendations/types'
import { RadioCandidateGenerator } from './candidateGenerator'

const ranked = (id: string, singer: string, reason: RankedRecommendation['reason']['type'] = 'artist_affinity', score = 1): RankedRecommendation => ({
  canonicalTrackId: id,
  variant: { canonicalTrackId: id, source: 'kw', sourceTrackId: id, track: { id, source: 'kw', name: `Song ${id}`, singer, albumName: `Album ${id}` }, metadataQuality: 1, lastSeenAt: 1 },
  bucket: 'new',
  reason: { type: reason, labels: [] },
  score,
})

describe('RadioCandidateGenerator', () => {
  it('excludes queued/exposed tracks and keeps artist spacing', () => {
    const values = [ranked('a', 'Same'), ranked('b', 'Same', 'artist_affinity', 0.9), ranked('c', 'Other', 'artist_affinity', 0.8), ranked('d', 'Explore', 'exploration', 0.1)]
    const ranker = { rankCandidates: () => values } as unknown as RecommendationRanker
    const result = new RadioCandidateGenerator(ranker).generate({
      currentTrack: null,
      queuedCanonicalIds: new Set(['a']),
      exposedCanonicalIds: new Set(),
      recentSessionItems: [],
      profile: null,
      isPlayableProvider: () => true,
      sourcePriority: () => 0,
      now: 1,
      limit: 3,
    })
    expect(result.map(item => item.canonicalTrackId)).toEqual(['b', 'c', 'd'])
    expect(result.some(item => item.reason.type === 'exploration')).toBe(true)
  })

  it('uses current artist affinity but penalizes a recently skipped artist', () => {
    const values = [ranked('a', 'Current', 'artist_affinity', 0.5), ranked('b', 'Other', 'artist_affinity', 0.6)]
    const ranker = { rankCandidates: () => values } as unknown as RecommendationRanker
    const generator = new RadioCandidateGenerator(ranker)
    const base = { currentTrack: { id: 'current', source: 'kw', name: 'Current', singer: 'Current' }, queuedCanonicalIds: new Set<string>(), exposedCanonicalIds: new Set<string>(), profile: null, isPlayableProvider: () => true, sourcePriority: () => 0, now: 1, limit: 2 }
    expect(generator.generate({ ...base, recentSessionItems: [] })[0].canonicalTrackId).toBe('a')
    expect(generator.generate({ ...base, recentSessionItems: [{ sessionId: 's', sequence: 1, recommendationItemId: 'r', canonicalTrackId: 'x', track: { id: 'x', source: 'kw', name: 'X', singer: 'Current' }, state: 'skipped', rankingSource: 'local', reason: { type: 'artist_affinity', labels: [] }, generatedAt: 1, startedAt: 1, endedAt: 2, completionRatio: 0.1 }] })[0].canonicalTrackId).toBe('b')
  })
})
