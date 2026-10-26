import { getPlayInfo } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { addListMusics, getListMusics, getUserLists, registerAction, removeListMusics } from '@renderer/store/list/action'
import { LIST_IDS } from '@common/constants'


import useInitUserApi from './useInitUserApi'
import { play, playList } from '@renderer/core/player'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { playMusicInfo } from '@renderer/store/player/state'

const initPrevPlayInfo = async() => {
  const info = await getPlayInfo()
  window.tuneflow.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return
  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  window.tuneflow.restorePlayInfo = info
  playList(info.listId, info.index)

  if (appSetting['player.startupAutoPlay']) {
    const musicInfo = playMusicInfo.musicInfo
    if (!musicInfo) return
    setTimeout(() => {
      if (musicInfo.id == playMusicInfo.musicInfo?.id) play()
    })
  }
}

const initServiceLibrary = async() => {
  const response = await fetch('/api/v1/library/tracks')
  if (!response.ok) throw new Error('Unable to load Service library')
  const body = await response.json() as { data?: Array<{ id: unknown, name: unknown, singer?: unknown, interval?: unknown, meta?: unknown }> }
  const tracks = (body.data ?? []).filter(item => typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && typeof item.name === 'string').map(item => ({
    id: item.id as string,
    name: item.name as string,
    singer: typeof item.singer === 'string' ? item.singer : '',
    source: 'local' as const,
    interval: typeof item.interval === 'string' ? item.interval : '00:00',
    meta: item.meta != null && typeof item.meta === 'object' ? item.meta : {},
  })) as TuneFlow.Music.MusicInfo[]
  const defaultTracks = await getListMusics(LIST_IDS.DEFAULT)
  const registryIds = new Set(tracks.map(track => track.id))
  const stale = defaultTracks.filter(track => track.source === 'local' && !registryIds.has(track.id)).map(track => track.id)
  if (stale.length) await removeListMusics({ listId: LIST_IDS.DEFAULT, ids: stale })
  if (tracks.length === 0) return
  const existing = new Set(defaultTracks.map(track => track.id))
  await addListMusics(LIST_IDS.DEFAULT, tracks.filter(track => !existing.has(track.id)))
}

export default () => {
  const initUserApi = useInitUserApi()

  let unregister: null | (() => void) = null

  onBeforeUnmount(() => {
    if (unregister) unregister()
  })

  return async() => {
    await initUserApi().catch(err => {
      log.error(err)
    })
    void music.init() // 初始化音乐sdk
    unregister = registerAction((ids) => {
      window.app_event.myListUpdate(ids)
    })
    window.tuneFlowData.userLists = await getUserLists() // 获取用户列表
    await initServiceLibrary()
    await initPrevPlayInfo().catch(err => {
      log.error(err)
    }) // 初始化上次的歌曲播放信息
  }
}
