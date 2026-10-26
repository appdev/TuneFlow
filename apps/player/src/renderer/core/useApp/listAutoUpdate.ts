import { getListUpdateInfo } from '@renderer/utils/data'
import { userLists } from '@renderer/store/list/state'
import syncSourceList, { isQQSyncList } from '@renderer/store/list/syncSourceList'

const INTERVAL = 10 * 60 * 1000
let initialized = false
let running = false
const lastAttempt = new Map<string, number>()

const refresh = async(startup = false) => {
  if (running || !navigator.onLine) return
  running = true
  try {
    const info = await getListUpdateInfo()
    for (const list of [...userLists]) {
      const setting = info[list.id]
      if (!setting?.isAutoUpdate || (!startup && !isQQSyncList(list))) continue
      if (isQQSyncList(list) && !setting.sourceAccountId) continue
      if (Date.now() - Math.max(lastAttempt.get(list.id) ?? 0, setting.updateTime) < INTERVAL) continue
      lastAttempt.set(list.id, Date.now())
      await syncSourceList(list, true).catch(() => {}) // 失败状态保留在同步管理中。
    }
  } finally {
    // 唯一运行中的任务结束后释放锁，期间其他入口只会跳过。
    // eslint-disable-next-line require-atomic-updates
    running = false
  }
}

export default () => {
  if (initialized) return
  initialized = true
  const update = () => { void refresh().catch(() => {}) }
  void refresh(true).catch(() => {})
  window.setInterval(update, INTERVAL)
  window.addEventListener('online', update)
  window.addEventListener('focus', update)
}
