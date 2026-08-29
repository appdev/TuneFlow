import { recommendationPolicy } from './policy'
import type { CatalogRepository } from './catalogRepository'
import { matchTaxonomy } from './tagTaxonomy'
import type { RecommendationTag } from './types'

const DAY_MS = 86_400_000

export class RelationIndex {
  constructor(private readonly catalog: CatalogRepository, private readonly now: () => number = Date.now) {}

  rebuild(seedIds: ReadonlySet<string>): void {
    if (seedIds.size === 0) return
    const now = this.now()
    const playlists = this.catalog.playlistsForSeeds(seedIds, now)
    const weightedCounts = new Map<string, number>()
    const pairWeights = new Map<string, Map<string, { weight: number, shared: number }>>()
    const tagEvidence = new Map<string, Map<string, { kind: RecommendationTag['kind'], value: string, playlists: Set<string>, weight: number }>>()
    for (const playlist of playlists) {
      const ageDays = Math.max(0, (now - playlist.sampledAt) / DAY_MS)
      const recency = Math.pow(0.5, ageDays / recommendationPolicy.playlistRefreshDays)
      const contribution = playlist.reliability * recency / Math.log2(2 + playlist.members.length)
      const matches = matchTaxonomy([playlist.name, playlist.description, ...playlist.labels])
      for (const member of playlist.members) weightedCounts.set(member, (weightedCounts.get(member) ?? 0) + contribution)
      for (const seed of playlist.members) {
        if (!seedIds.has(seed)) continue
        const targetMap = pairWeights.get(seed) ?? new Map()
        pairWeights.set(seed, targetMap)
        for (const candidate of playlist.members) {
          if (candidate === seed) continue
          const current = targetMap.get(candidate) ?? { weight: 0, shared: 0 }
          targetMap.set(candidate, { weight: current.weight + contribution, shared: current.shared + 1 })
        }
        const evidence = tagEvidence.get(seed) ?? new Map()
        tagEvidence.set(seed, evidence)
        for (const match of matches) {
          const key = `${match.kind}:${match.value}`
          const current = evidence.get(key) ?? { ...match, playlists: new Set<string>(), weight: 0 }
          if (!current.playlists.has(playlist.key)) {
            current.playlists.add(playlist.key)
            current.weight += contribution
          }
          evidence.set(key, current)
        }
      }
    }
    const neighbors = new Map<string, Array<{ candidateId: string, similarity: number, shared: number }>>()
    const tags = new Map<string, RecommendationTag[]>()
    for (const seed of seedIds) {
      const seedWeight = weightedCounts.get(seed) ?? 0
      neighbors.set(seed, [...(pairWeights.get(seed) ?? [])].map(([candidateId, pair]) => ({
        candidateId,
        similarity: seedWeight === 0 ? 0 : pair.weight / Math.sqrt(seedWeight * (weightedCounts.get(candidateId) ?? pair.weight)),
        shared: pair.shared,
      })).sort((a, b) => b.similarity - a.similarity || a.candidateId.localeCompare(b.candidateId)).slice(0, recommendationPolicy.neighborLimit))
      tags.set(seed, [...(tagEvidence.get(seed)?.values() ?? [])]
        .filter(item => item.playlists.size >= 3)
        .map(item => ({ kind: item.kind, value: item.value, support: item.playlists.size, confidence: Math.min(1, item.weight) })))
    }
    this.catalog.replaceRelations(seedIds, neighbors, tags, now)
  }
}
