import { onBeforeUnmount } from '@common/utils/vueTools'
import { getCurrentTime, getDuration } from '@renderer/plugins/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { createServicePlaybackSessionManager, type PlaybackTrack } from './playbackSession'

const currentTrack = (): PlaybackTrack | null => {
  const value = playMusicInfo.musicInfo
  if (value == null) return null
  return ('progress' in value ? value.metadata.musicInfo : value) as PlaybackTrack
}

const progress = () => ({ position: getCurrentTime(), duration: getDuration() })

export default () => {
  const sessions = createServicePlaybackSessionManager()
  const handlePlaying = () => {
    const track = currentTrack()
    if (track != null) void sessions.started(track)
  }
  const handleCompleted = () => { void sessions.completed(progress()) }
  const handleInterrupted = () => { void sessions.interrupted(progress()) }
  const handlePageHide = () => { sessions.dispose(progress()) }

  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerEnded', handleCompleted)
  window.app_event.on('musicToggled', handleInterrupted)
  window.app_event.on('stop', handleInterrupted)
  window.addEventListener('pagehide', handlePageHide)

  onBeforeUnmount(() => {
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerEnded', handleCompleted)
    window.app_event.off('musicToggled', handleInterrupted)
    window.app_event.off('stop', handleInterrupted)
    window.removeEventListener('pagehide', handlePageHide)
    sessions.dispose(progress())
  })
}
