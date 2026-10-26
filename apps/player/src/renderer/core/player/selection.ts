import { LIST_IDS } from '@common/constants'
import { appSetting } from '@renderer/store/setting'
import { getListMusics, setTempList } from '@renderer/store/list/action'
import { addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playList, playNext } from './action'

export const playSingle = (musicInfo: LX.Music.MusicInfo, listId: string | null = LIST_IDS.PLAY_LATER) => {
  const wasPlaying = !!playMusicInfo.musicInfo
  addTempPlayList([{ listId, musicInfo, isTop: true }])
  if (wasPlaying) void playNext()
}

let revision = 0
let pending = Promise.resolve()
const select = async(action: (isCurrent: () => boolean) => Promise<void>) => {
  const current = ++revision
  pending = pending.catch(() => {}).then(async() => {
    if (current == revision) await action(() => current == revision)
  })
  return pending
}

export const playFromList = async(listId: string, index: number) => select(async(isCurrent) => {
  const musicInfo = (await getListMusics(listId))[index]
  if (!musicInfo || !isCurrent()) return
  if (appSetting['list.singlePlayMode'] == 'add') playSingle(musicInfo, listId)
  else playList(listId, index)
})

export const playFromPage = async(key: string, list: LX.Music.MusicInfo[], index: number) => select(async(isCurrent) => {
  const musicInfo = list[index]
  if (!musicInfo) return
  if (appSetting['list.singlePlayMode'] == 'add') { playSingle(musicInfo); return }
  await setTempList(key, [...list])
  if (isCurrent()) playList(LIST_IDS.TEMP, index)
})
