import { clearTempPlayeList, addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playNext } from '@renderer/core/player'
import type { RecommendationItem } from './api'

export const playRecommendationQueue = (items: RecommendationItem[], startIndex = 0): void => {
  const shouldAdvance = playMusicInfo.musicInfo != null
  const queue = items.slice(startIndex).map(item => ({
    listId: null,
    musicInfo: item.track,
    isTop: false,
    playbackContext: { recommendationItemId: item.recommendationItemId },
  }))
  clearTempPlayeList()
  addTempPlayList(queue)
  if (shouldAdvance) void playNext()
}
