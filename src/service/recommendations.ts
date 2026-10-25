import { ServiceError, type TrackDto } from './client'
import type { ServiceWorkspace } from './workspace'

export type DailySource = 'server' | 'tx' | 'wy' | 'kg'
export interface PersonalDaily {
  list: LX.Music.MusicInfoOnline[]
  kind?: string
  status?: string
  reason?: string
}
export interface DailyFeed {
  list: LX.Music.MusicInfoOnline[]
  kind: string
  reason: string
  origin: 'account' | 'server'
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
  server: 'Docker 每日推荐',
}
export const serverDailyLabels: Record<string, string> = {
  ready: '今日推荐已就绪',
  warming: '服务器正在准备推荐，完成后自动更新',
  generating: '正在生成新一批推荐，完成后自动更新',
  disabled: '服务器推荐已关闭',
  degraded: '部分推荐来源暂不可用',
  stale: '正在更新今日推荐，暂时保留上次结果',
}
export const dailyFeedNotice = (feed: DailyFeed): string => {
  if (feed.origin === 'account') return feed.reason === 'official_unavailable' ? '官方日推暂不可用，已使用账号雷达推荐' : '根据当前平台账号的偏好推荐'
  const fallback = feed.reason ? (feed.reason === 'login_required' ? '账号未登录或已失效，使用 Docker 推荐。' : '个人推荐暂不可用，使用 Docker 推荐。') : ''
  return fallback + (serverDailyLabels[feed.status] ?? '服务器每日推荐')
}

// Personal credentials stay in the native account module. Only normalized song
// metadata enters the Service workspace; playback always resolves through Docker.
export const loadDailyFeed = async(
  workspace: ServiceWorkspace, source: DailySource,
  personal: (source: Exclude<DailySource, 'server'>, force: boolean, signal?: AbortSignal) => Promise<PersonalDaily>,
  force = false, signal?: AbortSignal,
): Promise<DailyFeed> => {
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
