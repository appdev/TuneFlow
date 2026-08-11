import type { SourcesService } from '../routes/sources'
import { ApiError } from '../errors'
import { toSourceMusicUrlInfo } from '../sources/musicInfo'
import { findAlternativeMusic } from '../lxSdk'
import { type TokenStore } from './tokenStore'

export interface ResolveTrackInput {
  source: string
  info: unknown
  quality: LX.Quality
}

export interface ResolvedTrack {
  url: string
  quality: LX.Quality
  expiresAt: number
}

export interface SourceMusicUrl {
  url: string
  headers?: Record<string, unknown>
}

export const resolveSourceMusicUrl = async(
  sources: SourcesService,
  sourceId: string,
  input: ResolveTrackInput,
  findAlternatives: (musicInfo: unknown) => Promise<Array<Record<string, unknown>>> = findAlternativeMusic,
  signal?: AbortSignal,
): Promise<SourceMusicUrl> => {
  const requestMusicUrl = async(musicSource: string, info: unknown): Promise<SourceMusicUrl> => {
    const request = {
      source: musicSource,
      action: 'musicUrl',
      info: toSourceMusicUrlInfo(info, input.quality),
    }
    return signal == null
      ? sources.requestSource<SourceMusicUrl>(sourceId, request)
      : sources.requestSource<SourceMusicUrl>(sourceId, request, signal)
  }
  const originalInfo = typeof input.info === 'object' && input.info != null && 'musicInfo' in input.info
    ? (input.info as { musicInfo: unknown }).musicInfo
    : input.info
  const activeSource = sources.list().find(source => source.id === sourceId && source.active)
  const supportsMusicUrl = (musicSource: string): boolean => {
    if (activeSource?.sources == null) return true
    return activeSource.sources[musicSource]?.actions.includes('musicUrl') ?? false
  }
  try {
    return await requestMusicUrl(input.source, input.info)
  } catch (originalError) {
    let alternatives: Array<Record<string, unknown>>
    try {
      alternatives = await findAlternatives(originalInfo)
    } catch {
      throw originalError
    }
    for (const alternative of alternatives) {
      if (typeof alternative.source !== 'string' || alternative.source === input.source) continue
      if (!supportsMusicUrl(alternative.source)) continue
      try {
        return await requestMusicUrl(alternative.source, alternative)
      } catch {}
    }
    throw originalError
  }
}

export class PlaybackResolver {
  constructor(
    private readonly sources: SourcesService,
    private readonly tokenStore: TokenStore,
    private readonly findAlternatives: (musicInfo: unknown) => Promise<Array<Record<string, unknown>>> = findAlternativeMusic,
  ) {}

  async resolveTrack(input: ResolveTrackInput): Promise<ResolvedTrack> {
    const source = this.sources.list().find(item => item.active)
    if (source == null) throw new ApiError(409, 'SOURCE_NOT_FOUND', 'No active source')
    const result = await resolveSourceMusicUrl(this.sources, source.id, input, this.findAlternatives)
    return this.createResolvedTrack(result, input.quality)
  }

  private createResolvedTrack(result: SourceMusicUrl, quality: LX.Quality): ResolvedTrack {
    const token = this.tokenStore.create({ url: result.url, headers: result.headers })
    const entry = this.tokenStore.get(token)
    if (entry == null) throw new ApiError(500, 'PLAYBACK_UNAVAILABLE', 'Playback token unavailable')
    return { url: `/api/v1/streams/${token}`, quality, expiresAt: entry.expiresAt }
  }
}
