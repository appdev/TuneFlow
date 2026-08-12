import { toRaw, markRawList } from '@common/utils/vueTools'
// import { qualityList } from '@renderer/store'
import { clearPlayedList } from '@renderer/store/player/action'
import { dislikeInfo } from '@renderer/store/dislikeList'

// export const getPlayType = (highQuality: boolean, musicInfo: TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem): TuneFlow.Quality | null => {
//   if ('progress' in musicInfo || musicInfo.source == 'local') return null
//   let type: TuneFlow.Quality = '128k'
//   let list = qualityList.value[musicInfo.source]
//   if (highQuality && musicInfo.meta._qualitys['320k'] && list?.includes('320k')) type = '320k'
//   return type
// }

/**
 * 过滤列表中已播放的歌曲
 */
export const filterList = async({ playedList, listId, list, playerMusicInfo, isNext }: {
  playedList: TuneFlow.Player.PlayMusicInfo[]
  listId: string
  list: Array<TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem>
  playerMusicInfo?: TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem
  isNext: boolean
}) => {
  // if (this.list.listName === null) return
  // console.log(isCheckFile)
  let { filteredList, canPlayList, playerIndex } = await window.tuneflow.worker.main.filterMusicList({
    listId,
    list: list.map(m => toRaw(m)),
    playedList: toRaw(playedList),
    // savePath: appSetting['download.savePath'],
    playerMusicInfo: toRaw(playerMusicInfo),
    dislikeInfo: { names: toRaw(dislikeInfo.names), musicNames: toRaw(dislikeInfo.musicNames), singerNames: toRaw(dislikeInfo.singerNames) },
    isNext,
  })

  if (!filteredList.length && playedList.length) {
    clearPlayedList()
    return { filteredList: markRawList(canPlayList), playerIndex }
  }
  return { filteredList: markRawList(filteredList), playerIndex }
}
