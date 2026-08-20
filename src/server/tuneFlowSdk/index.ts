import musicSdk from '../../renderer/utils/musicSdk'
import { SourceWorkerHost } from '../sources/worker-host'
import { toSourceMusicInfo } from '../sources/musicInfo'
import type { AlbumDetailResult, CatalogCollection, CatalogSearchKind, CollectionSearchResult, SearchRequest, SearchResult } from '../sources/types'

interface PlaylistProvider {
  search?: (text: string, page: number, limit: number) => Promise<unknown>
  sortList?: Array<{ id: string | number, name: string }>
  getTags?: () => Promise<unknown>
  getList?: (sortId: string, tagId: string, page: number) => Promise<unknown>
  getListDetail?: (playlistId: string, page: number) => Promise<unknown>
}

interface Provider {
  musicSearch?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  songList?: PlaylistProvider
  albumSearch?: { search: (text: string, page: number, limit: number) => Promise<unknown> }
  album?: { getAlbumDetail: (albumId: string, page: number) => Promise<unknown> }
  getLyric?: (musicInfo: unknown) => { promise: Promise<unknown> }
  getPic?: (musicInfo: unknown) => unknown
  leaderboard?: {
    getBoards: () => Promise<unknown>
    getList: (id: string, page: number) => Promise<unknown>
  }
}

interface ProviderSummary {
  id: string
  name: string
  searchKinds: CatalogSearchKind[]
  leaderboards: boolean
  albumDetail: boolean
  playlistDiscovery?: { tags: boolean, browse: boolean, detail: boolean }
}

export interface PlaylistTag { id: string, name: string }
export interface PlaylistTagGroup { name: string, tags: PlaylistTag[] }
export interface PlaylistDiscoveryFilters {
  source: string
  sorts: PlaylistTag[]
  hotTags: PlaylistTag[]
  groups: PlaylistTagGroup[]
}

export interface PlaylistBrowseResult {
  source: string
  page: number
  limit: number
  total: number | null
  hasMore: boolean
  list: CatalogCollection[]
}

export interface PlaylistDetailResult {
  source: string
  page: number
  limit: number
  total: number | null
  hasMore: boolean
  playlist: CatalogCollection
  tracks: Array<Record<string, unknown>>
}

export interface PlaylistBrowseInput {
  source: string
  sortId: string
  tagId: string
  page: number
}

export interface PlaylistDetailInput {
  source: string
  playlistId: string
  page: number
}

export interface LeaderboardSummary {
  id: string
  providerId: string
  name: string
  source: string
}

export interface LeaderboardResult {
  list: LeaderboardSummary[]
  source: string
}

const providers = musicSdk as unknown as Record<string, Provider> & { sources: Array<{ id: string, name: string }> }

const protocolError = (message: string): Error => Object.assign(new Error(message), { code: 'SOURCE_PROTOCOL_ERROR' })

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) throw protocolError(`Invalid ${label} response`)
  return value as Record<string, unknown>
}

const normalizeTag = (value: unknown): PlaylistTag => {
  const tag = asRecord(value, 'playlist tag')
  const id = String(tag.id ?? '')
  const name = String(tag.name ?? '')
  if (id.length === 0 || name.length === 0) throw protocolError('Playlist tag is missing required fields')
  return { id, name }
}

const normalizeCollection = (value: unknown, source: string, kind: 'playlist' | 'album' = 'playlist'): CatalogCollection => {
  const item = asRecord(value, kind)
  const id = String(item.id ?? '')
  if (id.length === 0) throw protocolError(`${kind === 'playlist' ? 'Playlist' : 'Album'} is missing an id`)
  return {
    ...item,
    id,
    kind,
    name: String(item.name ?? ''),
    source: typeof item.source === 'string' ? item.source : source,
    ...(typeof item.author === 'string' ? { author: item.author } : {}),
    ...(item.total != null && Number.isFinite(Number(item.total)) ? { total: Number(item.total) } : {}),
    ...(typeof item.img === 'string' || item.img === null ? { img: item.img } : {}),
    ...(item.play_count != null ? { playCount: String(item.play_count) } : item.playCount != null ? { playCount: String(item.playCount) } : {}),
    ...(typeof item.desc === 'string' ? { description: item.desc } : typeof item.description === 'string' ? { description: item.description } : {}),
  }
}

const numberOrNull = (value: unknown): number | null => value != null && Number.isFinite(Number(value)) ? Number(value) : null

const pageInfo = (result: Record<string, unknown>, requestedPage: number, listLength: number) => {
  const page = numberOrNull(result.page) ?? requestedPage
  const limit = numberOrNull(result.limit) ?? listLength
  const total = numberOrNull(result.total)
  return {
    page,
    limit,
    total,
    hasMore: total != null ? page * limit < total : limit > 0 && listLength >= limit,
  }
}

const playlistIdPatterns: Record<string, RegExp> = {
  kw: /^(?:digest-[A-Za-z0-9_-]+__)?[A-Za-z0-9_-]+$/,
  kg: /^(?:id_)?[A-Za-z0-9_-]+$/,
  tx: /^[A-Za-z0-9_-]+$/,
  wy: /^[A-Za-z0-9_-]+$/,
  mg: /^[A-Za-z0-9_-]+$/,
}

export const validatePlaylistId = (source: string, playlistId: string): string => {
  const points = Array.from(playlistId)
  const hasControlCharacter = points.some(point => {
    const codePoint = point.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  const invalid = points.length === 0 || points.length > 512 || hasControlCharacter ||
    playlistId.includes('://') || playlistId.startsWith('//') || playlistId.includes('###') ||
    !(playlistIdPatterns[source]?.test(playlistId) ?? false)
  if (invalid) throw Object.assign(new Error('Invalid playlist identifier'), { code: 'INVALID_PLAYLIST_ID' })
  return playlistId
}

const albumIdPatterns: Record<string, RegExp> = {
  wy: /^\d+$/,
  kw: /^\d+$/,
  kg: /^\d+$/,
  tx: /^[A-Za-z0-9]+$/,
  mg: /^\d+$/,
}

export const validateAlbumId = (source: string, albumId: string): string => {
  const points = Array.from(albumId)
  const hasControlCharacter = points.some(point => {
    const codePoint = point.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  const invalid = points.length === 0 || points.length > 128 || hasControlCharacter ||
    albumId.includes('://') || albumId.startsWith('//') || albumId.includes('###') ||
    !(albumIdPatterns[source]?.test(albumId) ?? false)
  if (invalid) throw Object.assign(new Error('Invalid album identifier'), { code: 'INVALID_ALBUM_ID' })
  return albumId
}

const playlistQueues = new Map<string, Promise<void>>()

const serializePlaylistCall = async<T>(source: string, work: () => Promise<T>): Promise<T> => {
  const previous = playlistQueues.get(source) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const tail = previous.catch(() => {}).then(async() => { await gate })
  playlistQueues.set(source, tail)
  await previous.catch(() => {})
  try {
    return await work()
  } finally {
    release()
    if (playlistQueues.get(source) === tail) playlistQueues.delete(source)
  }
}

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
  })
  if (list.some(item => item.id.length === 0)) throw Object.assign(new Error('Collection search result is missing an id'), { code: 'SOURCE_PROTOCOL_ERROR' })
  return { list, total: Number(result.total ?? list.length), limit: Number(result.limit ?? list.length), page, source: result.source }
}

export const catalogCapabilities = (): ProviderSummary[] => providers.sources.map(source => {
  const provider = providers[source.id]
  const playlistDiscovery = provider?.songList?.getTags != null && provider.songList.getList != null && provider.songList.getListDetail != null
    ? { tags: true, browse: true, detail: true }
    : undefined
  return {
    id: source.id,
    name: source.name,
    searchKinds: [
      ...(provider?.musicSearch == null ? [] : ['track'] as const),
      ...(provider?.songList == null ? [] : ['playlist'] as const),
      ...(provider?.albumSearch == null ? [] : ['album'] as const),
    ],
    leaderboards: provider?.leaderboard != null,
    albumDetail: provider?.album?.getAlbumDetail != null,
    ...(playlistDiscovery == null ? {} : { playlistDiscovery }),
  }
}).filter(provider => provider.searchKinds.length > 0)

const playlistProvider = (source: string): Required<Pick<PlaylistProvider, 'getTags' | 'getList' | 'getListDetail'>> & PlaylistProvider => {
  const songList = providers[source]?.songList
  if (songList?.getTags == null || songList.getList == null || songList.getListDetail == null) {
    throw Object.assign(new Error(`Playlist discovery is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  }
  return songList as Required<Pick<PlaylistProvider, 'getTags' | 'getList' | 'getListDetail'>> & PlaylistProvider
}

export const getPlaylistTags = async(source: string): Promise<PlaylistDiscoveryFilters> => {
  const songList = playlistProvider(source)
  return serializePlaylistCall(source, async() => {
    const result = asRecord(await songList.getTags(), 'playlist tags')
    if (!Array.isArray(result.tags) || !Array.isArray(result.hotTag)) throw protocolError('Invalid playlist tags response')
    const groups = result.tags.map(value => {
      const group = asRecord(value, 'playlist tag group')
      if (!Array.isArray(group.list)) throw protocolError('Invalid playlist tag group response')
      const name = String(group.name ?? '')
      if (name.length === 0) throw protocolError('Playlist tag group is missing a name')
      return { name, tags: group.list.map(normalizeTag) }
    })
    return {
      source,
      sorts: (songList.sortList ?? []).map(normalizeTag),
      hotTags: result.hotTag.map(normalizeTag),
      groups,
    }
  })
}

export const browsePlaylists = async({ source, sortId, tagId, page }: PlaylistBrowseInput): Promise<PlaylistBrowseResult> => {
  const songList = playlistProvider(source)
  return serializePlaylistCall(source, async() => {
    const result = asRecord(await songList.getList(sortId, tagId, page), 'playlist browse')
    if (!Array.isArray(result.list)) throw protocolError('Invalid playlist browse response')
    const list = result.list.map(item => normalizeCollection(item, source))
    return { source, ...pageInfo(result, page, list.length), list }
  })
}

export const getPlaylistDetail = async({ source, playlistId, page }: PlaylistDetailInput): Promise<PlaylistDetailResult> => {
  const validatedId = validatePlaylistId(source, playlistId)
  const songList = playlistProvider(source)
  return serializePlaylistCall(source, async() => {
    const result = asRecord(await songList.getListDetail(validatedId, page), 'playlist detail')
    if (!Array.isArray(result.list)) throw protocolError('Invalid playlist detail response')
    const normalizedTracks = SourceWorkerHost.normalizeSearchResult({ ...result, page: numberOrNull(result.page) ?? page })
    const info = result.info == null ? {} : asRecord(result.info, 'playlist detail info')
    const pagination = pageInfo(result, page, normalizedTracks.list.length)
    const playlist = normalizeCollection({ ...info, id: validatedId, source, total: pagination.total }, source)
    return {
      source,
      ...pagination,
      playlist,
      tracks: normalizedTracks.list,
    }
  })
}

export const getLeaderboards = async(source: string): Promise<LeaderboardResult> => {
  const leaderboard = providers[source]?.leaderboard
  if (leaderboard == null) throw Object.assign(new Error(`Leaderboard is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  const value = await leaderboard.getBoards()
  if (typeof value !== 'object' || value == null) throw Object.assign(new Error('Invalid leaderboard response'), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.list)) throw Object.assign(new Error('Invalid leaderboard response'), { code: 'SOURCE_PROTOCOL_ERROR' })
  const list = result.list.map(item => {
    const board = item != null && typeof item === 'object' ? item as Record<string, unknown> : {}
    const id = String(board.id ?? '')
    const providerId = String(board.bangid ?? id.replace(`${source}__`, ''))
    return { id, providerId, name: String(board.name ?? ''), source }
  })
  if (list.some(item => item.id.length === 0 || item.providerId.length === 0 || item.name.length === 0)) {
    throw Object.assign(new Error('Leaderboard response is missing required fields'), { code: 'SOURCE_PROTOCOL_ERROR' })
  }
  return { list, source }
}

export const getLeaderboardTracks = async(source: string, boardId: string, page: number): Promise<SearchResult> => {
  const leaderboard = providers[source]?.leaderboard
  if (leaderboard == null) throw Object.assign(new Error(`Leaderboard is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  const value = await leaderboard.getList(boardId, page)
  return SourceWorkerHost.normalizeSearchResult({ ...(value as Record<string, unknown>), page })
}

export const search = async({ source, text, page, limit }: SearchRequest): Promise<SearchResult> => {
  const provider = providers[source]
  if (provider?.musicSearch == null) throw Object.assign(new Error(`Unknown search source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = await provider.musicSearch.search(text, page, limit)
  return SourceWorkerHost.normalizeSearchResult({ ...(result as Record<string, unknown>), page })
}

export const searchCollections = async(kind: 'playlist' | 'album', { source, text, page, limit }: SearchRequest): Promise<CollectionSearchResult> => {
  const provider = providers[source]
  const searcher = kind === 'playlist' ? provider?.songList : provider?.albumSearch
  if (searcher?.search == null) throw Object.assign(new Error(`${kind} search is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  return normalizeCollectionSearchResult(await searcher.search(text, page, limit), kind, page)
}

export const getAlbumDetail = async({ source, albumId, page }: { source: string, albumId: string, page: number }): Promise<AlbumDetailResult> => {
  const validatedId = validateAlbumId(source, albumId)
  const detail = providers[source]?.album?.getAlbumDetail
  if (detail == null) throw Object.assign(new Error(`Album detail is not supported by source: ${source}`), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' })
  const result = asRecord(await detail.call(providers[source].album, validatedId, page), 'album detail')
  if (!Array.isArray(result.list)) throw protocolError('Invalid album detail response')
  const info = asRecord(result.info, 'album detail info')
  if (typeof info.name !== 'string' || info.name.trim().length === 0) {
    throw protocolError('Album detail is missing a name')
  }
  const normalizedTracks = SourceWorkerHost.normalizeSearchResult({ ...result, page: numberOrNull(result.page) ?? page })
  const pagination = pageInfo(result, page, normalizedTracks.list.length)
  return {
    source,
    ...pagination,
    album: normalizeCollection({ ...info, id: validatedId, source, total: pagination.total }, source, 'album'),
    tracks: normalizedTracks.list,
  }
}

export const getLyric = async(source: string, musicInfo: unknown): Promise<TuneFlow.Music.LyricInfo> => {
  const provider = (musicSdk as Record<string, Provider>)[source]
  if (provider?.getLyric == null) throw Object.assign(new Error(`Unknown lyric source: ${source}`), { code: 'SOURCE_PROTOCOL_ERROR' })
  const result = await provider.getLyric(toSourceMusicInfo(musicInfo)).promise
  if (typeof result !== 'object' || result == null || !('lyric' in result) || typeof result.lyric !== 'string') {
    throw Object.assign(new Error('Lyric provider returned invalid data'), { code: 'SOURCE_PROTOCOL_ERROR' })
  }
  return result as TuneFlow.Music.LyricInfo
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
