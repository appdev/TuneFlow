import initPlayer from './player'
import initPlayInfo from './playInfo'
import initPlayStatus from './playStatus'
import initPlayerEvent from './playerEvent'
import initWatchList from './watchList'
import initPlayProgress from './playProgress'
import initPreloadNextMusic from './preloadNextMusic'
import initLyric from './lyric'
import initServiceHistory from './serviceHistory'

export default async(setting: LX.AppSetting) => {
  await initPlayer(setting)
  initServiceHistory()
  await initLyric(setting)
  void initPlayInfo(setting).catch(() => { console.warn('Service playback restore unavailable') })
  initPlayStatus()
  initPlayerEvent()
  initWatchList()
  initPlayProgress()
  initPreloadNextMusic()
}
