import { getPlayInfo } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { getListMusics, registerAction } from '@renderer/store/list/action'


import { startServiceSession, subscribeService, serverDownloadSettings } from '@renderer/service/session'
import { play, playList } from '@renderer/core/player'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { userLists } from '@renderer/store/list/state'
import { playMusicInfo } from '@renderer/store/player/state'
import { initDislikeInfo, registerRemoteDislikeAction } from '@renderer/core/dislikeList'

const initPrevPlayInfo = async() => {
  const info = await getPlayInfo()
  window.lx.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return
  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  window.lx.restorePlayInfo = info
  playList(info.listId, info.index)

  if (appSetting['player.startupAutoPlay']) {
    const musicInfo = playMusicInfo.musicInfo
    if (!musicInfo) return
    setTimeout(() => {
      if (musicInfo.id == playMusicInfo.musicInfo?.id) play()
    })
  }
}

export default () => {
  let unregister: null | (() => void) = null
  let unregisterDislikeEvent: null | (() => void) = null
  const unsubscribeService = subscribeService(() => { mergeSetting(serverDownloadSettings as Partial<LX.AppSetting>) })

  onBeforeUnmount(() => {
    unsubscribeService()
    if (unregister) unregister()
    if (unregisterDislikeEvent) unregisterDislikeEvent()
  })

  return async() => {
    // Script execution and fallback live in Docker. Do not initialize a second
    // device source chain or wait for its readiness before Service playback.
    window.lx.apiInitPromise[2](true)
    void music.init() // 初始化音乐sdk
    unregister = registerAction((ids) => {
      window.app_event.myListUpdate(ids)
    })
    window.lxData.userLists = userLists
    startServiceSession()
    unregisterDislikeEvent = registerRemoteDislikeAction()
    await initDislikeInfo() // 获取不喜欢列表
    void initPrevPlayInfo().catch(err => {
      log.error(err)
    }) // 初始化上次的歌曲播放信息
  }
}
