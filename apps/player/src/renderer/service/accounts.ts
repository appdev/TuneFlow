import type { MusicAccountProvider, MusicAccountPlaylist } from '@renderer/utils/ipc'
import { getWorkspace, refreshServiceLists } from './session'
import { ServiceError } from './client'
import { sharedAccounts } from '../../../../../packages/service-client/src/accounts'
export { sharedAccounts }

export const accountNames = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐' }
export const notifyAccountsChanged = () => { window.dispatchEvent(new Event('qmusic-accounts-changed')) }
export const getSharedAccountStatus = async(refresh = false) => sharedAccounts(getWorkspace().client).status(refresh)
export const getSharedAccountPlaylists = async(provider: MusicAccountProvider) => sharedAccounts(getWorkspace().client).playlists(provider)
export const assertAccountOwner = async(provider: MusicAccountProvider, owner: string) => {
  const status = await getSharedAccountStatus()
  if (!status[provider] || !owner || status.accounts[provider]?.importOwner !== owner) throw new ServiceError('ACCOUNT_CHANGED')
}

export const importDesktopAccountPlaylist = async(provider: MusicAccountProvider, playlist: MusicAccountPlaylist, shouldCancel: () => boolean = () => false) => {
  const workspace = getWorkspace()
  const api = sharedAccounts(workspace.client)
  const status = await api.status()
  if (shouldCancel() || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  if (!playlist.importOwner || status.accounts[provider].importOwner !== playlist.importOwner) throw new ServiceError('ACCOUNT_CHANGED')
  const result = await api.import(provider, playlist.id, status.revisions[provider])
  if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
  await refreshServiceLists()
  return result
}

export const loadDesktopAccountPlaylist = async(provider: MusicAccountProvider, playlist: MusicAccountPlaylist, shouldCancel: () => boolean) => {
  const workspace = getWorkspace()
  const api = sharedAccounts(workspace.client)
  const status = await api.status()
  if (!playlist.importOwner || status.accounts[provider].importOwner !== playlist.importOwner) throw new ServiceError('ACCOUNT_CHANGED')
  const result = await api.tracks(provider, playlist.id, status.revisions[provider])
  if (shouldCancel() || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  return result.list.map(track => workspace.native(track))
}

export const loadDesktopAccountDaily = async(provider: MusicAccountProvider, force = false) => {
  const workspace = getWorkspace()
  const result = await sharedAccounts(workspace.client).daily(provider, force)
  if (result.status !== 'personalized') return { list: [], status: result.status }
  if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
  return { list: result.list.map(track => workspace.native(track)), status: result.kind ?? 'personalized' }
}
