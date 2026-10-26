import { toMD5 } from '@/utils/musicSdk/utils'
import { getQQSyncIdentity } from '@/core/musicAccount/qqCredentials'
import { getAccountDaily, type DailyProvider } from '@/core/musicAccount/daily'
import { assertPlaylistSession, getAccountPlaylistTracks, type PlaylistSession, type AccountPlaylist } from '@/core/musicAccount/playlists'
import { accountCollectionId, accountTracks, importAccountCollection } from './accountLibrary'
import { getWorkspace, refreshServiceLists } from './session'
import { ServiceError } from './client'

export const accountNames = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐' }
export const accountOwner = (session: PlaylistSession) => toMD5(session.provider === 'tx' ? getQQSyncIdentity(session.cookies) : `${session.provider}:${session.owner}`)
export const accountPlaylistId = (session: PlaylistSession, id: string) => accountCollectionId({ provider: session.provider, owner: accountOwner(session), id, name: '' })

export const importMobileAccountPlaylist = async(session: PlaylistSession, playlist: Pick<AccountPlaylist, 'id' | 'name'>, signal?: AbortSignal) => {
  const workspace = getWorkspace()
  const guard = async() => {
    if (signal?.aborted) throw new ServiceError('CANCELLED')
    if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
    await assertPlaylistSession(session)
    if (signal?.aborted === true || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  }
  await guard()
  const musics = await getAccountPlaylistTracks(session, playlist.id, signal)
  const result = await importAccountCollection(workspace, { provider: session.provider, owner: accountOwner(session), id: playlist.id, name: playlist.name }, musics, guard)
  await refreshServiceLists()
  return result
}

export const loadMobileAccountDaily = async(provider: DailyProvider, force: boolean, signal?: AbortSignal) => {
  const workspace = getWorkspace()
  const result = await getAccountDaily(provider, force, signal, false)
  if (signal?.aborted === true || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  return { ...result, list: accountTracks(workspace, result.list) }
}
