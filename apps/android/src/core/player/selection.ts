import { LIST_IDS } from '@/config/constant'
import settingState from '@/store/setting/state'
import { getListMusics, setTempList } from '@/core/list'
import playerActions from '@/store/player/action'
import { playList, playNext } from './player'

export const playSingle = async(musicInfo: LX.Music.MusicInfo, listId: string | null = LIST_IDS.PLAY_LATER) => {
  playerActions.addTempPlayList([{ listId, musicInfo, isTop: true }])
  await playNext()
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
  if (settingState.setting['list.singlePlayMode'] == 'add') await playSingle(musicInfo, listId)
  else await playList(listId, index)
})

export const playFromPage = async(key: string, list: LX.Music.MusicInfoOnline[], index: number) => select(async(isCurrent) => {
  const musicInfo = list[index]
  if (!musicInfo) return
  if (settingState.setting['list.singlePlayMode'] == 'add') { await playSingle(musicInfo); return }
  await setTempList(key, [...list])
  if (isCurrent()) await playList(LIST_IDS.TEMP, index)
})
