import playerState from '@/store/player/state'
import { getServiceProvenance } from '@/service/tracks'
import { ServicePlaybackHistory } from '@/service/history'
import TrackPlayer, { Event, State } from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'

export default () => {
  const history = new ServicePlaybackHistory(() => { console.warn('Service playback history unavailable') })
  let observedTrack: LX.Player.PlayMusic | null = null
  let timer: number | null = null
  const clearTimer = () => {
    if (timer != null) BackgroundTimer.clearInterval(timer)
    timer = null
  }
  const sampleProgress = async(track: LX.Player.PlayMusic) => {
    const [position, duration] = await Promise.all([TrackPlayer.getPosition(), TrackPlayer.getDuration()])
    if (observedTrack === track && playerState.playMusicInfo.musicInfo === track) history.progress(position, duration, track.id)
  }
  const sample = (track: LX.Player.PlayMusic) => { void sampleProgress(track).catch(() => {}) }
  const observePlaying = async() => {
    const track = playerState.playMusicInfo.musicInfo
    const service = track && getServiceProvenance(track)
    if (!track || !service) return
    const index = await TrackPlayer.getCurrentTrack()
    if (index == null) return
    const nativeTrack = await TrackPlayer.getTrack(index) as LX.Player.Track | null
    const state = await TrackPlayer.getState()
    const nativeId = String(nativeTrack?.id ?? '')
    if (playerState.playMusicInfo.musicInfo === track && (nativeTrack?.musicId === track.id || nativeId.startsWith(`${track.id}__//`)) && !nativeId.endsWith('__//default') && state === State.Playing) {
      history.playing(track.id, service)
      observedTrack = track
      sample(track)
      if (timer == null) timer = BackgroundTimer.setInterval(() => { sample(track) }, 1000)
    }
  }
  const observe = () => { void observePlaying().catch(() => { console.warn('Unable to observe native playback history') }) }
  // The existing app event intentionally drops native events during URL loading.
  // Observe the same native player directly and verify its actual track instead.
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (state === State.Playing) observe()
    else if (state === State.Paused || state === State.Stopped || state === State.None) {
      clearTimer()
      if (observedTrack) sample(observedTrack)
    }
  })
  TrackPlayer.addEventListener(Event.PlaybackTrackChanged, () => { clearTimer(); observedTrack = null; observe() })
  global.state_event.on('playProgressChanged', progress => {
    const key = playerState.playMusicInfo.musicInfo?.id
    if (key) history.progress(progress.nowPlayTime, progress.maxPlayTime, key)
  })
  const end = (completed: boolean) => { clearTimer(); observedTrack = null; history.end(completed) }
  global.app_event.on('musicToggled', () => { end(false) })
  global.app_event.on('playerEnded', () => { end(true) })
  global.app_event.on('stop', () => { end(false) })
}
