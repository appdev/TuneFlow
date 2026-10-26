import { AppState } from 'react-native'
import listState from '@/store/list/state'
import { getListUpdateInfo } from '@/utils/data'
import syncSourceList, { waitForSourceListSync } from '@/core/syncSourceList'
import { parseAccountSourceId, waitForAccountSync } from './playlistSync'
import { setPlaylistSyncState } from './syncState'

const INTERVAL = 10 * 60 * 1000
const lastAttempt = new Map<string, number>()
let initialized = false
let running = false
export const isQQSyncList = (list: LX.List.UserListInfo) => list.source == 'tx' && !!list.sourceListId && !!parseAccountSourceId(list.sourceListId)

export const refreshQQList = async(list: LX.List.UserListInfo, automatic = false) => {
  try {
    await syncSourceList(list, automatic)
  } catch (error) {
    setPlaylistSyncState(list.id, { phase: 'error', current: 0, total: 0, error: error instanceof Error ? error.message : 'unavailable' })
    throw error
  }
}

const refresh = async() => {
  if (running || AppState.currentState != 'active') return
  running = true
  try {
    const info = await getListUpdateInfo()
    for (const list of [...listState.userList]) {
      const settings = info[list.id]
      if (AppState.currentState != 'active') break
      if (!isQQSyncList(list) || !settings?.isAutoUpdate || !settings.sourceAccountId) continue
      if (Date.now() - Math.max(settings.updateTime, lastAttempt.get(list.id) ?? 0) < INTERVAL) continue
      lastAttempt.set(list.id, Date.now())
      await refreshQQList(list, true).catch(() => {})
    }
  } finally {
    // 只有当前任务负责释放锁，重入请求不会修改 running。
    // eslint-disable-next-line require-atomic-updates
    running = false
  }
}

export const syncQQFavorites = async(owner: string, binding: string) => {
  const info = await getListUpdateInfo()
  const targets = listState.userList.filter(list => {
    const account = list.sourceListId ? parseAccountSourceId(list.sourceListId) : null
    return list.source == 'tx' && account?.owner == owner && account.id == 'dir:201' && info[list.id]?.isAutoUpdate && info[list.id]?.sourceAccountId == binding
  })
  // 等待包括打开账号会话在内的旧同步，再拉取收藏后的最新快照。
  await Promise.all(targets.map(async list => waitForSourceListSync(list.id)))
  await waitForAccountSync('tx', owner, 'dir:201')
  const current = await getListUpdateInfo()
  const active = targets.filter(list => current[list.id]?.isAutoUpdate && listState.userList.some(item => item.id == list.id && item.source == 'tx' && item.sourceListId == list.sourceListId))
  const results = await Promise.allSettled(active.map(async list => refreshQQList(list, true)))
  return { total: active.length, failed: results.filter(result => result.status == 'rejected').length }
}

export const initPlaylistAutoSync = () => {
  if (initialized) return
  initialized = true
  const update = () => { void refresh().catch(() => {}) }
  update()
  setInterval(update, INTERVAL)
  AppState.addEventListener('change', state => { if (state == 'active') update() })
}
