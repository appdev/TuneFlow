import { onBeforeUnmount } from '@common/utils/vueTools'
import { playMusicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { createDownloadTasks } from '@renderer/store/download/action'

export default () => {
  const inFlight = new Set<string>()

  const handlePlaying = () => {
    if (!appSetting['player.autoDownloadOnPlay']) return
    const musicInfo = playMusicInfo.musicInfo
    if (musicInfo == null || 'progress' in musicInfo || musicInfo.source === 'local') return
    const identity = `${musicInfo.source}:${musicInfo.id}`
    if (inFlight.has(identity)) return
    inFlight.add(identity)
    void createDownloadTasks(
      [musicInfo],
      'flac24bit',
      playMusicInfo.listId ?? undefined,
      { skipExisting: true, qualityPolicy: 'highest' },
    ).catch(error => {
      console.warn('Unable to save playing track', error)
    }).finally(() => {
      inFlight.delete(identity)
    })
  }

  window.app_event.on('playerPlaying', handlePlaying)
  onBeforeUnmount(() => {
    window.app_event.off('playerPlaying', handlePlaying)
  })
}
