import { ServiceError, type TrackDto } from './client'
import type { DailyTrack, DailyWorkspace } from './types'

export type DailySource = 'server' | 'tx' | 'wy' | 'kg'
export interface PersonalDaily<Track extends DailyTrack = DailyTrack> {
  list: Track[]
  kind?: string
  status?: string
  reason?: string
}
export interface DailyFeed<Track extends DailyTrack = DailyTrack> {
  list: Track[]
  kind: string
  reason: string
  origin: 'account' | 'public' | 'server'
  status: string
  version?: string | number | null
}
interface ServerDaily {
  status: string
  version?: string | number | null
  lastErrorCode?: string | null
  items: Array<{ track: TrackDto, recommendationItemId: string }>
}
export const dailyKindNames: Record<string, string> = {
  official_daily: 'QQ 官方每日30首',
  radar: 'QQ 账号雷达推荐',
  netease_daily: '网易云每日推荐',
  kugou_daily: '酷狗每日推荐',
  tx_public: 'QQ 音乐精选',
  wy_public: '网易云音乐精选',
  kg_public: '酷狗音乐精选',
  server: '今日推荐',
}
export const serverDailyLabels: Record<string, string> = {
  ready: '今日推荐已就绪',
  warming: '正在准备推荐，完成后自动更新',
  generating: '正在生成新一批推荐，完成后自动更新',
  disabled: '推荐已关闭',
  degraded: '部分推荐来源暂不可用',
  stale: '正在更新今日推荐，暂时保留上次结果',
}
export const dailyFeedNotice = (feed: DailyFeed): string => {
  if (feed.origin === 'account') return feed.reason === 'official_unavailable' ? '官方日推暂不可用，已使用账号雷达推荐' : '根据当前平台账号的偏好推荐'
  if (feed.origin === 'public') return '精选平台公开歌单，发现值得一听的音乐'
  return serverDailyLabels[feed.status] ?? '发现值得一听的音乐'
}

interface CachedDaily<Track extends DailyTrack = DailyTrack> { feed: DailyFeed<Track>, covers?: string[], identity: string, day: string, savedAt: number }
const feedCache = new WeakMap<object, Map<DailySource, CachedDaily>>()
export const readDailyFeedCache = <Track extends DailyTrack>(workspace: DailyWorkspace<Track>, source: DailySource, identity: string) => {
  const cache = feedCache.get(workspace)
  const value = cache?.get(source)
  if (!value) return
  const ttl = value.feed.status === 'ready' ? 15 * 60_000 : 5000
  if (value.identity !== identity || value.day !== new Date().toDateString() || Date.now() - value.savedAt >= ttl) { cache?.delete(source); return }
  return value as CachedDaily<Track>
}
export const cacheDailyFeed = <Track extends DailyTrack>(workspace: DailyWorkspace<Track>, source: DailySource, identity: string, feed: DailyFeed<Track>, covers?: string[]) => {
  let cache = feedCache.get(workspace)
  if (!cache) { cache = new Map(); feedCache.set(workspace, cache) }
  cache.set(source, { feed, covers, identity, day: new Date().toDateString(), savedAt: Date.now() })
}
export const clearDailyFeedCache = (workspace: object, origin?: DailyFeed['origin']) => {
  const cache = feedCache.get(workspace)
  if (!origin) cache?.clear()
  else for (const [source, value] of cache ?? []) if (value.feed.origin === origin) cache?.delete(source)
}

const publicSelections = new WeakMap<object, Partial<Record<DailySource, number>>>()
const loadPublicDaily = async<Track extends DailyTrack>(workspace: DailyWorkspace<Track>, source: Exclude<DailySource, 'server'>, force: boolean, signal?: AbortSignal): Promise<DailyFeed<Track>> => {
  const controller = new AbortController()
  const abort = () => { controller.abort() }
  signal?.addEventListener('abort', abort)
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, 8000)
  try {
    const sortId = { tx: '5', wy: 'hot', kg: '5' }[source]
    const page = await workspace.client.request<{ list: Array<{ id: string }> }>('/api/v1/catalog/playlists/browse', 'POST', { source, sortId, tagId: '', page: 1 }, controller.signal)
    if (!page.list?.length) throw new ServiceError('PUBLIC_RECOMMENDATIONS_EMPTY')
    const selections = publicSelections.get(workspace) ?? {}
    const selected = ((selections[source] ?? 0) + (force ? 1 : 0)) % page.list.length
    for (let offset = 0; offset < Math.min(3, page.list.length); offset++) {
      const index = (selected + offset) % page.list.length
      const detail = await workspace.client.request<{ tracks: TrackDto[] }>('/api/v1/catalog/playlists/detail', 'POST', { source, playlistId: String(page.list[index].id), page: 1 }, controller.signal)
      const tracks = detail.tracks?.filter(track => track.source === source)
      if (!tracks?.length) continue
      selections[source] = index; publicSelections.set(workspace, selections)
      return { list: tracks.slice(0, 30).map(track => workspace.native(track)), origin: 'public', kind: source + '_public', status: 'ready', reason: '' }
    }
    throw new ServiceError('PUBLIC_RECOMMENDATIONS_EMPTY')
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

// Personal credentials stay in the native account module. Only normalized song
// metadata enters the Service workspace; playback always resolves through Docker.
export const loadDailyFeed = async<Track extends DailyTrack>(
  workspace: DailyWorkspace<Track>, source: DailySource,
  personal: (source: Exclude<DailySource, 'server'>, force: boolean, signal?: AbortSignal) => Promise<PersonalDaily<Track>>,
  force = false, signal?: AbortSignal,
): Promise<DailyFeed<Track>> => {
  const check = () => { if (signal?.aborted) throw new ServiceError('CANCELLED') }
  check()
  let reason = ''
  if (source !== 'server') {
    try {
      const value = await personal(source, force, signal)
      check()
      if (value.list.length) return { list: value.list, kind: value.kind ?? value.status ?? 'personalized', reason: value.reason ?? '', origin: 'account', status: 'ready' }
      reason = value.reason ? value.reason : (value.status ?? 'unavailable')
    } catch (error) {
      check()
      // Account/endpoint changes are cancellation boundaries, not a reason to
      // show another account's response or trigger a server mutation.
      if (error instanceof ServiceError && ['ACCOUNT_CHANGED', 'SERVER_CHANGED', 'CANCELLED'].includes(error.code)) throw error
      reason = 'unavailable'
    }
  }
  check()
  if (source !== 'server') {
    try {
      const value = await loadPublicDaily(workspace, source, force, signal)
      check()
      return value
    } catch (error) {
      check()
      if (error instanceof ServiceError && ['SOURCE_TARGET_BLOCKED', 'SOURCE_RESPONSE_TOO_LARGE', 'SOURCE_CANCELLED', 'ACCOUNT_CHANGED', 'SERVER_CHANGED'].includes(error.code)) throw error
    }
  }
  check()
  if (force) await workspace.client.request('/api/v1/recommendations/daily/refresh', 'POST', undefined, signal)
  check()
  const value = await workspace.client.request<ServerDaily>('/api/v1/recommendations/daily', 'GET', undefined, signal)
  check()
  return {
    list: value.items.map(item => {
      const track = workspace.native(item.track)
      track.meta.service.recommendationItemId = item.recommendationItemId
      return track
    }),
    kind: 'server',
    reason,
    origin: 'server',
    status: value.status,
    version: value.version,
  }
}
