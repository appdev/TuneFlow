import { SPLIT_CHAR } from '@common/constants'

export const filterMusicList = async({ playedList, listId, list, playerMusicInfo, dislikeInfo, isNext }: {
  playedList: TuneFlow.Player.PlayMusicInfo[]
  listId: string
  list: Array<TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem>
  playerMusicInfo?: TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem
  dislikeInfo: Omit<TuneFlow.Dislike.DislikeInfo, 'rules'>
  isNext: boolean
}) => {
  let playerIndex = -1
  const canPlayList: Array<TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem> = []
  const filteredPlayedList = playedList.filter(info => info.listId == listId && !info.isTempPlay).map(({ musicInfo }) => musicInfo)
  const hasDislike = (info: TuneFlow.Music.MusicInfo) => {
    const name = info.name?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''
    const singer = info.singer?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''
    return dislikeInfo.musicNames.has(name) || dislikeInfo.singerNames.has(singer) || dislikeInfo.names.has(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
  }

  let isDislike = false
  const filteredList = list.filter(item => {
    if ('progress' in item) {
      if (!item.isComplate) return false
    } else if (hasDislike(item)) {
      if (item.id != playerMusicInfo?.id) return false
      isDislike = true
    }

    canPlayList.push(item)
    const index = filteredPlayedList.findIndex(music => music.id == item.id)
    if (index > -1) {
      filteredPlayedList.splice(index, 1)
      return false
    }
    return true
  })

  if (playerMusicInfo) {
    if (isDislike) {
      if (filteredList.length <= 1) {
        filteredList.splice(0, 1)
        if (canPlayList.length > 1) {
          const currentMusicIndex = canPlayList.findIndex(music => music.id == playerMusicInfo.id)
          if (isNext) {
            playerIndex = currentMusicIndex - 1
            if (playerIndex < 0 && canPlayList.length > 1) playerIndex = canPlayList.length - 2
          } else {
            playerIndex = currentMusicIndex
            if (canPlayList.length <= 1) playerIndex = -1
          }
          canPlayList.splice(currentMusicIndex, 1)
        } else canPlayList.splice(0, 1)
      } else {
        const currentMusicIndex = filteredList.findIndex(music => music.id == playerMusicInfo.id)
        if (isNext) {
          playerIndex = currentMusicIndex - 1
          if (playerIndex < 0 && filteredList.length > 1) playerIndex = filteredList.length - 2
        } else {
          playerIndex = currentMusicIndex
          if (filteredList.length <= 1) playerIndex = -1
        }
        filteredList.splice(currentMusicIndex, 1)
      }
    } else {
      playerIndex = (filteredList.length ? filteredList : canPlayList).findIndex(music => music.id == playerMusicInfo.id)
    }
  }

  return { filteredList, canPlayList, playerIndex }
}
