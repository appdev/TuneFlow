import listState from '@/store/list/state'
import { createList, getListMusics, overwriteListMusics, setFetchingListStatus } from '@/core/list'
import { getListUpdateInfo, setListUpdateTime, setListSourceAccount, setListSourceSnapshot, setListAutoUpdate } from '@/utils/data'
import { createSourceSnapshot, mergeSourcePlaylist } from '@/utils/playlistMerge'
import { getQQSyncIdentity } from './qqCredentials'
import { setPlaylistSyncState } from './syncState'
import { assertPlaylistSession, getAccountPlaylistTracks, type AccountPlaylist, type PlaylistSession } from './playlists'
import { isServiceMode } from '@/service/session'
import { accountPlaylistId, importMobileAccountPlaylist } from '@/service/accounts'

// 来源包含账号 ID，避免切换账号后将两个“我喜欢”写进同一个列表。
export const accountSourceId = (owner: string, id: string) => `account:${owner}:${id}`
export const parseAccountSourceId = (sourceId: string) => {
  const match = /^account:(\d+):((?:dir:)?\d+)$/.exec(sourceId)
  return match ? { owner: match[1], id: match[2] } : null
}
export const findAccountList = (session: PlaylistSession, id: string) => listState.userList.find(item => isServiceMode() ? item.id === accountPlaylistId(session, id) : item.source == session.provider && item.sourceListId == accountSourceId(session.owner, id))
const pending = new Map<string, Promise<{ id: string, count: number }>>()

const performSync = async(session: PlaylistSession, playlist: Pick<AccountPlaylist, 'id' | 'name'>, signal?: AbortSignal, target?: LX.List.UserListInfo, automatic = false) => {
  const sourceListId = accountSourceId(session.owner, playlist.id)
  const existing = target ?? findAccountList(session, playlist.id)
  const originalSourceId = existing?.sourceListId
  const id = existing?.id ?? `account_${session.provider}_${session.owner}_${playlist.id.replace(':', '_')}`
  const settings = (await getListUpdateInfo())[id]
  const binding = session.provider == 'tx' ? getQQSyncIdentity(session.cookies) : undefined
  setFetchingListStatus(id, true)
  setPlaylistSyncState(id, { phase: 'fetch', current: 0, total: 0 })
  try {
    if (binding && settings?.sourceAccountId && settings.sourceAccountId != binding) throw new Error('account_changed')
    if (automatic && (!settings?.isAutoUpdate || (session.provider == 'tx' && !settings.sourceAccountId))) throw new Error('cancelled')
    await assertPlaylistSession(session)
    const tracks = await getAccountPlaylistTracks(session, playlist.id, signal, (current, total) => {
      setPlaylistSyncState(id, { phase: 'fetch', current, total })
    })
    await assertPlaylistSession(session)
    if (signal?.aborted) throw new Error('cancelled')
    if (automatic && !(await getListUpdateInfo())[id]?.isAutoUpdate) throw new Error('cancelled')
    // 所有分页完整返回后才写入；用户删除或重新关联的歌单不接受迟到结果。
    if (existing && !listState.userList.some(item => item.id == id && item.source == session.provider && item.sourceListId == originalSourceId)) throw new Error('list_removed')
    setPlaylistSyncState(id, { phase: 'save', current: tracks.length, total: tracks.length })
    const sourceKey = `${session.provider}:${originalSourceId ?? sourceListId}`
    if (existing) {
      const current = await getListMusics(id)
      if (signal?.aborted == true || !listState.userList.some(item => item.id == id && item.source == session.provider && item.sourceListId == originalSourceId)) throw new Error('cancelled')
      await overwriteListMusics(id, mergeSourcePlaylist(current, tracks, sourceKey, settings?.sourceSnapshot))
    } else await createList({ id, name: playlist.name, source: session.provider, sourceListId, list: tracks })
    await setListSourceSnapshot(id, createSourceSnapshot(sourceKey, tracks))
    if (binding) {
      await setListSourceAccount(id, binding)
      if (!existing) await setListAutoUpdate(id, true)
    }
    await setListUpdateTime(id, Date.now())
    setPlaylistSyncState(id, { phase: 'success', current: tracks.length, total: tracks.length })
    return { id, count: tracks.length }
  } catch (error) {
    setPlaylistSyncState(id, { phase: 'error', current: 0, total: 0, error: error instanceof Error ? error.message : 'unavailable' })
    throw error
  } finally {
    setFetchingListStatus(id, false)
  }
}

export const syncAccountPlaylist = async(session: PlaylistSession, playlist: Pick<AccountPlaylist, 'id' | 'name'>, signal?: AbortSignal, target?: LX.List.UserListInfo, automatic = false) => {
  if (isServiceMode()) {
    if (automatic) throw new Error('cancelled')
    const key = `service:${accountPlaylistId(session, playlist.id)}`
    const running = pending.get(key)
    if (running) return running
    const task = importMobileAccountPlaylist(session, playlist, signal).finally(() => { pending.delete(key) })
    pending.set(key, task)
    return task
  }
  const key = `${session.provider}:${accountSourceId(session.owner, playlist.id)}`
  const running = pending.get(key)
  if (running) return running
  const task = performSync(session, playlist, signal, target, automatic).finally(() => { pending.delete(key) })
  pending.set(key, task)
  return task
}

export const waitForAccountSync = async(provider: string, owner: string, id: string) => {
  await pending.get(`${provider}:${accountSourceId(owner, id)}`)?.catch(() => {})
}
