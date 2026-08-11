import musicSdk from '../../renderer/utils/musicSdk'
import { SourceWorkerHost } from '../sources/worker-host'
import { toSourceMusicInfo } from '../sources/musicInfo'
import type { SearchRequest, SearchResult } from '../sources/types'

interface Provider {
  musicSearch?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  getLyric?: (musicInfo: unknown) => { promise: Promise<unknown> }
  getPic?: (musicInfo: unknown) => unknown
}

export const search = async({ source, text, page, limit }: SearchRequest): Promise<SearchResult> => {
  const provider = (musicSdk as Record<string, Provider>)[source]
  if (provider?.musicSearch == null) throw Object.assign(new Error(`Unknown search source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = await provider.musicSearch.search(text, page, limit)
  return SourceWorkerHost.normalizeSearchResult({ ...(result as Record<string, unknown>), page })
}

export const getLyric = async(source: string, musicInfo: unknown): Promise<LX.Music.LyricInfo> => {
  const provider = (musicSdk as Record<string, Provider>)[source]
  if (provider?.getLyric == null) throw Object.assign(new Error(`Unknown lyric source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = await provider.getLyric(toSourceMusicInfo(musicInfo)).promise
  if (typeof result !== 'object' || result == null || !('lyric' in result) || typeof result.lyric !== 'string') {
    throw Object.assign(new Error('Lyric provider returned invalid data'), { code: 'SOURCE_PROTOCOL_ERROR' })
  }
  return result as LX.Music.LyricInfo
}

export const getPicture = async(source: string, musicInfo: unknown): Promise<string> => {
  const provider = (musicSdk as Record<string, Provider>)[source]
  if (provider?.getPic == null) throw Object.assign(new Error(`Unknown picture source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const request = provider.getPic(toSourceMusicInfo(musicInfo))
  const result = typeof request === 'object' && request != null && 'promise' in request
    ? await request.promise
    : await request
  if (typeof result !== 'string' || !/^https?:\/\//.test(result)) {
    throw Object.assign(new Error('Picture provider returned invalid data'), { code: 'SOURCE_PROTOCOL_ERROR' })
  }
  return result
}

export const findAlternativeMusic = async(musicInfo: unknown): Promise<Array<Record<string, unknown>>> => {
  const sourceInfo = toSourceMusicInfo(musicInfo)
  if (typeof sourceInfo !== 'object' || sourceInfo == null) return []
  return await musicSdk.findMusic(sourceInfo) as Array<Record<string, unknown>>
}

export default musicSdk
