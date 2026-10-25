import { ServiceError, type ServiceClient, type TrackDto, type LibraryDto, type Page, type CollectionDto } from './client'
import { getServiceProvenance, toServiceTrack, type ServiceTrack } from './tracks'

export const LIBRARY_ID = 'service_library'
export const HISTORY_ID = 'service_history'
export const isReadOnlyList = (id: string) => id === LIBRARY_ID || id === HISTORY_ID
export const LIBRARY_LIST = { id: LIBRARY_ID, name: '音乐库', locationUpdateTime: null }
export const DEFAULT_ENDPOINT = 'http://192.168.0.70:3124'
export const PROFILE_KEY = 'qmusic.docker.endpoint.v1'
const scopedDataKeys = new Set(['playInfo', 'listScrollPosition', 'listPrevSelectId', 'listUpdateInfo', '@play_info', '@list_scroll_position', '@list_prev_select_id', '@list_update_info'])
export const scopeClientDataKey = (key: string, endpoint: string) => scopedDataKeys.has(key) ? `serviceData_${encodeURIComponent(endpoint).replace(/\./g, '%2E')}_${key}` : key

// Only these settings describe shared server work. Presentation, audio output,
// queues and credentials must never be copied into the shared settings store.
export const isServerSetting = (key: string) => key.startsWith('download.') || key === 'common.apiSource'
export const downloadSettingLabels: Record<string, string> = {
  'download.enable': '启用下载',
  'download.maxDownloadNum': '同时下载任务数',
  'download.savePath': '服务器保存目录',
  'download.fileName': '文件名格式',
  'download.isSavePathGroupByListName': '按歌单整理目录',
  'download.skipExistFile': '跳过已有音频',
  'download.isDownloadLrc': '保存歌词文件',
  'download.isDownloadVerbatimLyric': '保存逐字歌词',
  'download.isDownloadTLrc': '保存翻译歌词',
  'download.isDownloadRLrc': '保存罗马音歌词',
  'download.isEmbedPic': '内嵌封面',
  'download.isEmbedLyric': '内嵌歌词',
  'download.isEmbedVerbatimLyric': '内嵌逐字歌词',
  'download.isEmbedLyricT': '内嵌翻译歌词',
  'download.isEmbedLyricR': '内嵌罗马音歌词',
  'download.isUseOtherSource': '下载时允许切换平台',
}

interface ListOperation {
  id: string
  listId: string
  fromId: string
  toId: string
  musicInfoId: string
  position: number
  ids: string[]
  listInfos: LX.List.UserListInfo[]
  musicInfos: LX.Music.MusicInfo[]
  addMusicLocationType: LX.AddMusicLocationType
}
interface Tag { id: string, name: string }
interface CollectionPage extends Page<CollectionDto> { tracks: TrackDto[], playlist: CollectionDto }

/** One domain adapter used behind the original native pages. No device DB writes. */
export class ServiceWorkspace {
  private readonly identities = new Map<string, string>()
  private temp: LX.Music.MusicInfo[] = []
  constructor(readonly client: ServiceClient) {}

  native(track: TrackDto, library?: LibraryDto): ServiceTrack {
    const isLibrary = track.source === 'local'
    const base = `/api/v1/library/tracks/${encodeURIComponent(String(track.id))}`
    const result = toServiceTrack(track, this.client.endpoint, isLibrary ? {
      streamPath: library?.streamUrl ?? base + '/stream',
      picturePath: library?.pictureUrl ?? base + '/picture',
      lyricsPath: library?.lyricsUrl ?? base + '/lyrics',
    } : {})
    this.identities.set(result.id, track.id)
    return result
  }

  original(track: LX.Music.MusicInfo): TrackDto {
    const service = getServiceProvenance(track)
    if (service) {
      if (service.endpoint !== this.client.endpoint) throw new ServiceError('DIFFERENT_SERVER')
      return service.track
    }
    // A device path is never a server-library path. Do not silently upload it.
    if (track.source === 'local') throw new ServiceError('DEVICE_FILE_NOT_IN_SERVER_LIBRARY')
    return JSON.parse(JSON.stringify(track)) as TrackDto
  }

  remoteId(id: string): string {
    if (this.identities.has(id)) return this.identities.get(id)!
    const prefix = `service:${this.client.endpoint}:`
    if (id.startsWith(prefix)) return id.slice(prefix.length).replace(/^[^:]+:/, '')
    if (id.startsWith('service:')) throw new ServiceError('DIFFERENT_SERVER')
    return id
  }

  async playlists(): Promise<LX.List.UserListInfo[]> {
    const lists = await this.client.request<LX.List.UserListInfo[]>('/api/v1/playlists')
    return [LIBRARY_LIST, { id: HISTORY_ID, name: '播放历史', locationUpdateTime: null }, ...lists]
  }

  async tracks(id: string): Promise<LX.Music.MusicInfo[]> {
    if (id === 'temp') return this.temp
    if (id === LIBRARY_ID) return (await this.client.library()).map(item => this.native(item.musicInfo ?? item, item))
    if (id === HISTORY_ID) {
      const entries = await this.client.request<Array<{ track: TrackDto }>>('/api/v1/playback/history')
      const seen = new Set<string>()
      return entries.map(item => item.track).filter(track => {
        const key = `${track.source}:${track.id}`
        if (seen.has(key)) return false
        seen.add(key); return true
      }).map(track => this.native(track))
    }
    return (await this.client.playlist(id)).tracks.map(item => this.native(item))
  }

  async lists(action: string, input: unknown): Promise<unknown> {
    const data = input as ListOperation
    const request = async<T = unknown>(path: string, method = 'GET', body?: unknown) => this.client.request<T>(path, method, body)
    const path = (id: string) => `/api/v1/playlists/${encodeURIComponent(id)}`
    const originals = (tracks: LX.Music.MusicInfo[]) => tracks.map(track => this.original(track))
    const ids = (values: string[]) => values.map(id => this.remoteId(id))
    if (action === 'get') return this.playlists()
    if (action === 'music_get') return this.tracks(String(input))
    const targets = [data?.id, data?.listId, data?.fromId, data?.toId, ...(Array.isArray(input) ? (input as Array<string | { id: string }>).map(item => typeof item === 'string' ? item : item.id) : [])]
    if (targets.some(id => typeof id === 'string' && isReadOnlyList(id))) throw new ServiceError('LIBRARY_IS_READ_ONLY')
    if (data?.listId === 'temp' && action === 'music_overwrite') { this.temp = data.musicInfos; return }
    switch (action) {
      case 'add': return request('/api/v1/playlists', 'POST', { position: Math.max(0, data.position - 2), playlists: data.listInfos })
      case 'remove': return Promise.all((input as string[]).map(async(id: string) => request(path(id), 'DELETE')))
      case 'update': return request('/api/v1/playlists', 'PATCH', { playlists: input })
      case 'update_position': return request('/api/v1/playlists/reorder', 'POST', { ...data, position: Math.max(0, data.position - 2) })
      case 'music_add': return request(path(data.id) + '/tracks', 'POST', { tracks: originals(data.musicInfos), position: data.addMusicLocationType })
      case 'music_remove': return request(path(data.listId) + '/tracks/remove', 'POST', { trackIds: ids(data.ids) })
      case 'music_move': return request('/api/v1/playlists/tracks/move', 'POST', { ...data, musicInfos: originals(data.musicInfos) })
      case 'music_update': {
        const grouped = new Map<string, TrackDto[]>()
        for (const { id, musicInfo } of input as LX.List.ListActionMusicUpdate) grouped.set(id, [...(grouped.get(id) ?? []), this.original(musicInfo)])
        return Promise.all([...grouped].map(async([id, tracks]) => request(path(id) + '/tracks', 'PATCH', { tracks })))
      }
      case 'music_update_position': return request(path(data.listId) + '/tracks/reorder', 'POST', { position: data.position, trackIds: ids(data.ids) })
      case 'music_overwrite': return request(path(data.listId) + '/tracks', 'PUT', { tracks: originals(data.musicInfos) })
      case 'music_clear': return Promise.all((input as string[]).map(async(id: string) => request(path(id) + '/tracks', 'DELETE')))
      case 'music_check_exist': return request(path(data.listId) + `/tracks/${encodeURIComponent(this.remoteId(data.musicInfoId))}/exists`)
      case 'music_get_list_ids': return request(`/api/v1/tracks/${encodeURIComponent(this.remoteId(String(input)))}/playlists`)
      case 'data_overwire': {
        const value = input as LX.List.ListActionDataOverwrite
        return request('/api/v1/playlists/import', 'POST', {
          ...value,
          defaultList: originals(value.defaultList),
          loveList: originals(value.loveList),
          userList: value.userList.filter(list => !isReadOnlyList(list.id)).map(list => ({ ...list, list: originals(list.list) })),
          tempList: undefined,
        })
      }
      default: throw new ServiceError('UNSUPPORTED_LIST_OPERATION')
    }
  }

  async search(source: string, text: string, page = 1, limit = 30, kind: 'tracks' | 'playlists' | 'albums' = 'tracks') {
    const value = await this.client.request<Page<TrackDto & CollectionDto>>(`/api/v1/catalog/${kind}/search`, 'POST', { source, text, page, pageSize: Math.min(100, limit) })
    return { ...value, allPage: Math.ceil((value.total ?? 0) / value.limit), list: kind === 'tracks' ? value.list.map(track => this.native(track)) : value.list.map(collection) }
  }

  async tags(source: string) {
    const value = await this.client.request<{ groups: Array<{ name: string, tags: Tag[] }>, hotTags: Tag[], sorts: Tag[] }>('/api/v1/catalog/playlists/tags', 'POST', { source })
    return { source, tags: value.groups.map(group => ({ name: group.name, list: group.tags.map(tag => ({ ...tag, source })) })), hotTag: value.hotTags.map(tag => ({ ...tag, source })), sorts: value.sorts }
  }

  async browse(source: string, sortId: string, tagId: string, page = 1) {
    const value = await this.client.request<CollectionPage>('/api/v1/catalog/playlists/browse', 'POST', { source, sortId: String(sortId ?? ''), tagId: String(tagId ?? ''), page })
    return { ...value, total: pageTotal(value), list: value.list.map(collection) }
  }

  async detail(source: string, playlistId: string, page = 1) {
    const value = await this.client.request<CollectionPage>('/api/v1/catalog/playlists/detail', 'POST', { source, playlistId: String(playlistId), page })
    return { ...value, total: pageTotal(value), info: collection(value.playlist), list: value.tracks.map((track: TrackDto) => this.native(track)) }
  }

  async boards(source: string) {
    const value = await this.client.request<{ list: Array<{ id: string, name: string, providerId: string }> }>('/api/v1/catalog/leaderboards', 'POST', { source })
    return { source, list: value.list.map(board => ({ ...board, id: `${source}__${board.providerId}` })) }
  }

  async board(source: string, boardId: string, page = 1) {
    const value = await this.client.request<Page<TrackDto>>('/api/v1/catalog/leaderboards/tracks', 'POST', { source, boardId: String(boardId).replace(new RegExp(`^${source}__`), ''), page })
    return { ...value, total: pageTotal(value), list: value.list.map((track: TrackDto) => this.native(track)) }
  }

  async album(source: string, albumId: string) {
    if (!['tx', 'wy', 'kg', 'kw', 'mg'].includes(source) || !/^[a-z\d_-]+$/i.test(String(albumId))) throw new ServiceError('INVALID_ALBUM_ID')
    const tracks: ServiceTrack[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 100; page++) {
      const value = await this.client.request<CollectionPage>('/api/v1/catalog/albums/detail', 'POST', { source, albumId: String(albumId), page })
      const fresh = value.tracks.filter(track => !seen.has(track.id))
      if (value.hasMore && !fresh.length) throw new ServiceError('ALBUM_PAGINATION_REPEATED')
      for (const track of fresh) { seen.add(track.id); tracks.push(this.native(track)) }
      if (!value.hasMore) {
        if (value.total !== null && tracks.length < value.total) throw new ServiceError('ALBUM_INCOMPLETE')
        return tracks
      }
    }
    throw new ServiceError('ALBUM_PAGE_LIMIT')
  }
}

const pageTotal = (value: Page<unknown> & { tracks?: TrackDto[] }) => value.total ?? ((value.page - 1) * value.limit + (value.list ?? value.tracks ?? []).length + (value.hasMore ? value.limit : 0))
const collection = (item: CollectionDto) => ({ ...item, img: item.img ?? '', pic: item.img ?? '', singer: item.author ?? '', desc: item.description ?? '', play_count: item.playCount ?? '', total: item.total ?? 0 })

/** Keep native page contracts, replacing only network operations. */
export const installServiceCatalog = (sources: any, get: () => ServiceWorkspace) => {
  const current = async<T>(action: (workspace: ServiceWorkspace) => Promise<T>): Promise<T> => {
    const workspace = get()
    const result = await action(workspace)
    if (workspace !== get()) throw new ServiceError('SERVER_CHANGED')
    return result
  }
  sources.sources = sources.sources.filter((item: { id: string }) => ['kw', 'kg', 'tx', 'wy', 'mg'].includes(item.id))
  for (const { id } of sources.sources as Array<{ id: string }>) {
    const sdk = sources[id]
    sdk.init = async() => {}
    sdk.musicSearch = { ...sdk.musicSearch, search: async(text: string, page = 1, limit = 30) => current(async workspace => workspace.search(id, text, page, limit)) }
    sdk.songList = {
      ...sdk.songList,
      search: async(text: string, page = 1, limit = 30) => current(async workspace => workspace.search(id, text, page, limit, 'playlists')),
      getTags: async() => current(async workspace => workspace.tags(id)),
      getList: async(sort: string, tag: string, page: number) => current(async workspace => workspace.browse(id, sort, tag, page)),
      getListDetail: async(listId: string, page: number) => current(async workspace => workspace.detail(id, listId, page)),
    }
    sdk.leaderboard = { ...sdk.leaderboard, getBoards: async() => current(async workspace => workspace.boards(id)), getList: async(boardId: string, page: number) => current(async workspace => workspace.board(id, boardId, page)) }
    // Service has no hot/suggestion API. Do not contact providers from the device.
    sdk.hotSearch = { ...sdk.hotSearch, getList: async() => [], search: async() => [] }
    sdk.tipSearch = { ...sdk.tipSearch, search: async() => [] }
  }
}
