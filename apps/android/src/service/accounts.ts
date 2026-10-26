import { toMD5 } from '@/utils/musicSdk/utils'
import { getQQSyncIdentity } from '@/core/musicAccount/qqCredentials'
import { type DailyProvider } from '@/core/musicAccount/daily'
import { assertPlaylistSession, getAccountPlaylistTracks, type PlaylistSession, type AccountPlaylist } from '@/core/musicAccount/playlists'
import { accountCollectionId, importAccountCollection } from './accountLibrary'
import { getWorkspace, refreshServiceLists } from './session'
import { ServiceError } from './client'
import { sharedAccounts } from '../../../../packages/service-client/src/accounts'
import { getProviderCookies, getQQCredentials } from '@/core/musicAccount/cookies'
import { readKugouSession } from '@/core/musicAccount/kugou'
import { NativeModules } from 'react-native'
export { sharedAccounts }
export const getSharedAccountStatus = async() => sharedAccounts(getWorkspace().client).status()
export const publishMobileAccount = async(provider: 'tx' | 'wy' | 'kg') => {
  const workspace = getWorkspace()
  const api = sharedAccounts(workspace.client); const status = await api.status()
  const names = provider === 'tx' ? ['qqmusic_key', 'qm_keyst', 'musickey', 'qqmusic_uin', 'musicid', 'login_type', 'wxuin', 'uin'] : ['MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID']
  const cookies = provider === 'kg' ? {} : await getProviderCookies(provider)
  const credential = { cookies: Object.fromEntries(Object.entries(cookies).filter(([name]) => names.includes(name))), ...(provider === 'kg' ? { kugou: await readKugouSession() } : {}), ...(provider === 'tx' ? { dailyKey: await NativeModules.MusicCredentialModule?.getQQDailyKey(getQQCredentials(cookies).uin).catch(() => null) ?? undefined } : {}) }
  if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
  await api.upload(provider, status.revisions[provider], credential)
}

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
  const result = await sharedAccounts(workspace.client).daily(provider, force)
  if (signal?.aborted === true || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  return { ...result, kind: result.kind ?? 'local', reason: result.status === 'personalized' ? '' : result.status, list: result.list.map(track => workspace.native(track)) }
}
