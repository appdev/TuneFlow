import { onBeforeUnmount } from '@common/utils/vueTools'
import { getCurrentTime, getDuration, getResource, onPlaying, onPause, onTimeupdate, onEnded } from '@renderer/plugins/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { ServicePlaybackHistory } from '@renderer/service/history'
import { getServiceProvenance, isResolvedServiceResource } from '@renderer/service/tracks'

export default () => {
  const history = new ServicePlaybackHistory(() => { console.warn('Docker 播放历史同步失败') })
  let observed: LX.Music.MusicInfo | null = null
  const sample = () => {
    const selected = playMusicInfo.musicInfo
    if (!observed || selected !== observed) return
    history.progress(getCurrentTime(), getDuration(), observed.id)
  }
  const finish = (completed = false) => {
    sample()
    history.end(completed)
    observed = null
  }
  const playing = () => {
    const selected = playMusicInfo.musicInfo
    const service = getServiceProvenance(selected)
    if (!selected || 'progress' in selected || !service || !isResolvedServiceResource(service, getResource())) return
    observed = selected
    history.playing(selected.id, service)
    sample()
  }
  // Register before Q's ended handler advances its selected track.
  const releases = [onPlaying(playing), onPause(sample), onTimeupdate(sample), onEnded(() => { finish(true) })]
  const toggled = () => { finish() }
  window.app_event.on('musicToggled', toggled)
  window.app_event.on('stop', toggled)
  const closing = () => { finish() }
  window.addEventListener('beforeunload', closing)
  onBeforeUnmount(() => {
    finish()
    releases.forEach(release => { release() })
    window.app_event.off('musicToggled', toggled)
    window.app_event.off('stop', toggled)
    window.removeEventListener('beforeunload', closing)
  })
}
