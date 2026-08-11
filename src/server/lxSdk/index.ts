import musicSdk from '../../renderer/utils/musicSdk'
import { SourceWorkerHost } from '../sources/worker-host'
import { toSourceMusicInfo } from '../sources/musicInfo'
import type { CatalogSearchKind, CollectionSearchResult, SearchRequest, SearchResult } from '../sources/types'

interface Provider {
  musicSearch?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  songList?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  albumSearch?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  getLyric?: (musicInfo: unknown) => { promise: Promise<unknown> }
  getPic?: (musicInfo: unknown) => unknown
}

interface ProviderSummary {
  id: string
  name: string
  searchKinds: CatalogSearchKind[]
}

const providers = musicSdk as unknown as Record<string, Provider> & { sources: Array<{ id: string, name: string }> }

const normalizeCollectionSearchResult = (value: unknown, kind: 'playlist' | 'album', page: number): CollectionSearchResult => {
  if (typeof value !== 'object' || value == null) throw Object.assign(new Error('Invalid collection search response'), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.list) || typeof result.source !== 'string') throw Object.assign(new Error('Invalid collection search response'), { code: 'SOURCE_PROTOCOL_ERROR' })
  const list = result.list.map(item => {
    const collection = item != null && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      ...collection,
      id: String(collection.id ?? ''),
      kind,
      name: String(collection.name ?? ''),
      source: typeof collection.source === 'string' ? collection.source : result.source as string,
      ...(typeof collection.author === 'string' ? { author: collection.author } : {}),
      ...(Number.isFinite(Number(collection.total)) ? { total: Number(collection.total) } : {}),
      ...(typeof collection.img === 'string' || collection.img === null ? { img: collection.img } : {}),
      ...(typeof collection.desc === 'string' ? { description: collection.desc } : typeof collection.description === 'string' ? { description: collection.description } : {}),
    }
  }).filter(item => item.id.length > 0)
  return { list, total: Number(result.total ?? list.length), limit: Number(result.limit ?? list.length), page, source: result.source }
}

export const catalogCapabilities = (): ProviderSummary[] => providers.sources.map(source => {
  const provider = providers[source.id]
  return {
    id: source.id,
    name: source.name,
    searchKinds: [
      ...(provider?.musicSearch == null ? [] : ['track'] as const),
      ...(provider?.songList == null ? [] : ['playlist'] as const),
      ...(provider?.albumSearch == null ? [] : ['album'] as const),
    ],
  }
}).filter(provider => provider.searchKinds.length > 0)

export const search = async({ source, text, page, limit }: SearchRequest): Promise<SearchResult> => {
  const provider = providers[source]
  if (provider?.musicSearch == null) throw Object.assign(new Error(`Unknown search source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = await provider.musicSearch.search(text, page, limit)
  return SourceWorkerHost.normalizeSearchResult({ ...(result as Record<string, unknown>), page })
}

export const searchCollections = async(kind: 'playlist' | 'album', { source, text, page, limit }: SearchRequest): Promise<CollectionSearchResult> => {
  const provider = providers[source]
  const searcher = kind === 'playlist' ? provider?.songList : provider?.albumSearch
  if (searcher == null) throw Object.assign(new Error(`${kind} search is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  return normalizeCollectionSearchResult(await searcher.search(text, page, limit), kind, page)
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
