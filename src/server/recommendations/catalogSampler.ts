import {
  browsePlaylists,
  catalogCapabilities,
  getLeaderboardTracks,
  getLeaderboards,
  getPlaylistDetail,
  getPlaylistTags,
  type ProviderSummary,
} from '../tuneFlowSdk'
import { recommendationPolicy } from './policy'
import type { CatalogRepository } from './catalogRepository'
import type { RelationIndex } from './relationIndex'

export interface CatalogSamplerDependencies {
  providers?: () => ProviderSummary[]
  isPlayableProvider: (source: string) => boolean
  getTags?: typeof getPlaylistTags
  browse?: typeof browsePlaylists
  detail?: typeof getPlaylistDetail
  getBoards?: typeof getLeaderboards
  getBoardTracks?: typeof getLeaderboardTracks
  now?: () => number
}

export interface CatalogSampleResult { sampled: number, failedSources: string[], eligibleSources: string[], sourceCoverage: string[] }

const errorCode = (error: unknown): string => typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string'
  ? error.code
  : 'CATALOG_SAMPLE_FAILED'

export class CatalogSampler {
  private closed = false

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly relations: RelationIndex,
    private readonly dependencies: CatalogSamplerDependencies,
  ) {}

  async run(mode: 'bootstrap' | 'daily'): Promise<CatalogSampleResult> {
    if (this.closed) return { sampled: 0, failedSources: [], eligibleSources: [], sourceCoverage: [] }
    const now = this.dependencies.now?.() ?? Date.now()
    const affected = this.catalog.expirePlaylists(now)
    const failedSources: string[] = []
    let sampled = 0
    const providers = (this.dependencies.providers ?? catalogCapabilities)()
      .filter(provider => provider.playlistDiscovery?.browse === true && this.dependencies.isPlayableProvider(provider.id))
    const eligibleSources = providers.map(provider => provider.id)
    for (const provider of providers) {
      if (this.closed) break
      try {
        sampled += await this.sampleProvider(provider, mode, now, affected)
      } catch (error) {
        failedSources.push(`${provider.id}:${errorCode(error)}`)
      }
    }
    if (!this.closed) this.relations.rebuild(affected)
    const sourceCoverage = this.catalog.activeSources(now, new Set(eligibleSources))
    return { sampled, failedSources, eligibleSources, sourceCoverage }
  }

  close(): void { this.closed = true }

  private async sampleProvider(provider: ProviderSummary, mode: 'bootstrap' | 'daily', now: number, affected: Set<string>): Promise<number> {
    const getTags = this.dependencies.getTags ?? getPlaylistTags
    const browse = this.dependencies.browse ?? browsePlaylists
    const detail = this.dependencies.detail ?? getPlaylistDetail
    const filters = await getTags(provider.id)
    const tagged = [...filters.hotTags, ...filters.groups.flatMap(group => group.tags)]
    const uniqueTags = [...new Map(tagged.map(tag => [tag.id, tag])).values()]
    const targets = uniqueTags.length === 0 ? [{ id: '', name: '' }] : uniqueTags
    const limit = mode === 'bootstrap' ? recommendationPolicy.bootstrapPlaylistsPerSource : recommendationPolicy.dailyRefreshPlaylistsPerSource
    const leaderboardBudget = provider.leaderboards ? Math.min(2, limit) : 0
    const playlistBudget = limit - leaderboardBudget
    const playlists = new Map<string, { id: string, name: string, description: string, label: string }>()
    for (const tag of targets) {
      if (playlists.size >= playlistBudget || this.closed) break
      const page = await browse({ source: provider.id, sortId: filters.sorts[0]?.id ?? '', tagId: tag.id, page: 1 })
      for (const item of page.list) {
        if (playlists.size >= playlistBudget) break
        playlists.set(item.id, { id: item.id, name: item.name, description: item.description ?? '', label: tag.name })
      }
    }
    let sampled = 0
    for (const playlist of playlists.values()) {
      if (this.closed) break
      if (!this.isRefreshDue(provider.id, playlist.id, now)) continue
      const tracks = new Map<string, Record<string, unknown>>()
      let pageNumber = 1
      let playlistName = playlist.name
      let description = playlist.description
      while (tracks.size < recommendationPolicy.maxTracksPerPlaylist) {
        const page = await detail({ source: provider.id, playlistId: playlist.id, page: pageNumber })
        playlistName = page.playlist.name || playlistName
        description = page.playlist.description ?? description
        for (const track of page.tracks) {
          const id = `${String(track.source ?? provider.id)}:${String(track.id ?? track.songmid ?? '')}`
          if (!tracks.has(id)) tracks.set(id, track)
          if (tracks.size >= recommendationPolicy.maxTracksPerPlaylist) break
        }
        if (!page.hasMore || page.tracks.length === 0) break
        pageNumber += 1
      }
      const changed = this.catalog.replacePlaylist({
        source: provider.id,
        playlistId: playlist.id,
        name: playlistName,
        description,
        labels: [playlist.label].filter(Boolean),
        sampledAt: now,
        expiresAt: now + recommendationPolicy.playlistExpiryDays * 86_400_000,
        reliability: 1,
        tracks: [...tracks.values()],
      })
      for (const id of changed) affected.add(id)
      sampled += 1
    }
    if (provider.leaderboards && !this.closed && sampled < limit) {
      sampled += await this.sampleLeaderboard(provider.id, now, affected, Math.min(leaderboardBudget, limit - sampled))
    }
    return sampled
  }

  private async sampleLeaderboard(source: string, now: number, affected: Set<string>, budget: number): Promise<number> {
    if (budget === 0) return 0
    const getBoards = this.dependencies.getBoards ?? getLeaderboards
    const getTracks = this.dependencies.getBoardTracks ?? getLeaderboardTracks
    const boards = await getBoards(source)
    let sampled = 0
    for (const board of boards.list.slice(0, budget)) {
      const playlistId = `leaderboard-${board.providerId}`
      if (!this.isRefreshDue(source, playlistId, now)) continue
      const page = await getTracks(source, board.providerId, 1)
      const changed = this.catalog.replacePlaylist({
        source,
        playlistId,
        name: board.name,
        description: '',
        labels: ['leaderboard'],
        sampledAt: now,
        expiresAt: now + recommendationPolicy.playlistRefreshDays * 86_400_000,
        reliability: 0.65,
        tracks: page.list.slice(0, recommendationPolicy.maxTracksPerPlaylist),
      })
      for (const id of changed) affected.add(id)
      sampled += 1
    }
    return sampled
  }

  private isRefreshDue(source: string, playlistId: string, now: number): boolean {
    const sampledAt = this.catalog.playlistSampledAt(source, playlistId)
    return sampledAt == null || now - sampledAt >= recommendationPolicy.playlistRefreshDays * 86_400_000
  }
}
