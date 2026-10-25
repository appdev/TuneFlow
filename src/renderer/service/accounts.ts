import { getMusicAccountDaily, getMusicAccountStatus, type MusicAccountProvider, type MusicAccountPlaylist } from '@renderer/utils/ipc'
import { loadAccountPlaylistMusic, loadKugouHashMusic } from '@renderer/views/List/MyList/importPlaylist'
import txMusicInfo from '@renderer/utils/musicSdk/tx/musicInfo'
import wyMusicDetail from '@renderer/utils/musicSdk/wy/musicDetail'
import { toNewMusicInfo } from '@renderer/utils'
import { getWorkspace, refreshServiceLists } from './session'
import { accountTracks, importAccountCollection } from './accountLibrary'
import { ServiceError } from './client'

export const accountNames = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐' }
export const notifyAccountsChanged = () => { window.dispatchEvent(new Event('qmusic-accounts-changed')) }
export const assertAccountOwner = async(provider: MusicAccountProvider, owner: string) => {
  const status = await getMusicAccountStatus()
  if (!status[provider] || !owner || status.accounts[provider]?.importOwner !== owner) throw new ServiceError('ACCOUNT_CHANGED')
}

export const importDesktopAccountPlaylist = async(provider: MusicAccountProvider, playlist: MusicAccountPlaylist, shouldCancel: () => boolean = () => false) => {
  const workspace = getWorkspace()
  const owner = playlist.importOwner ?? ''
  const guard = async() => {
    if (shouldCancel()) throw new ServiceError('CANCELLED')
    if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
    await assertAccountOwner(provider, owner)
    if (shouldCancel() || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  }
  await guard()
  const musics = await loadAccountPlaylistMusic(provider, playlist.id, undefined, shouldCancel, { accountId: playlist.accountId, importOwner: owner })
  const result = await importAccountCollection(workspace, { provider, owner, id: playlist.id, name: playlist.name }, musics, guard)
  await refreshServiceLists()
  return result
}

export const loadDesktopAccountPlaylist = async(provider: MusicAccountProvider, playlist: MusicAccountPlaylist, shouldCancel: () => boolean) => {
  const workspace = getWorkspace()
  const musics = await loadAccountPlaylistMusic(provider, playlist.id, undefined, shouldCancel, { accountId: playlist.accountId, importOwner: playlist.importOwner })
  await assertAccountOwner(provider, playlist.importOwner ?? '')
  if (shouldCancel() || workspace !== getWorkspace()) throw new ServiceError('CANCELLED')
  return accountTracks(workspace, musics)
}

export const loadDesktopAccountDaily = async(provider: MusicAccountProvider) => {
  const workspace = getWorkspace()
  const result = await getMusicAccountDaily(provider)
  if (result.status !== 'personalized') return { list: [], status: result.status }
  let musics: LX.Music.MusicInfo[]
  if (provider === 'kg') musics = await loadKugouHashMusic(result.ids)
  else if (provider === 'wy') musics = (await wyMusicDetail.getList(result.ids)).list.map(toNewMusicInfo)
  else musics = (await Promise.all(result.ids.slice(0, 30).map(id => txMusicInfo(id).catch(() => null)))).filter(Boolean).map(toNewMusicInfo)
  await assertAccountOwner(provider, result.importOwner ?? '')
  if (workspace !== getWorkspace()) throw new ServiceError('SERVER_CHANGED')
  return { list: accountTracks(workspace, musics), status: result.kind ?? 'personalized' }
}
