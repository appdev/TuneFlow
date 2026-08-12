import { reactive, shallowReactive, ref } from '@common/utils/vueTools'

export interface PlayerMusicInfo {
  id: string | null
  pic: string | null
  lrc: string | null
  tlrc: string | null
  rlrc: string | null
  verbatimLyric: string | null
  rawlrc: string | null
  // url: string | null
  name: string
  singer: string
  album: string
}

export const musicInfo = window.tuneFlowData.musicInfo = reactive<PlayerMusicInfo>({
  id: null,
  pic: null,
  lrc: null,
  tlrc: null,
  rlrc: null,
  verbatimLyric: null,
  rawlrc: null,
  // url: null,
  name: '',
  singer: '',
  album: '',
})

export const isPlay = ref(false)

export const status = window.tuneFlowData.status = ref('')

export const statusText = ref('')

export const isShowPlayerDetail = ref(false)

export const isShowPlayComment = ref(false)

export const isShowLrcSelectContent = ref(false)

export const playMusicInfo = shallowReactive<{
  /**
   * 当前播放歌曲的列表 id
   */
  musicInfo: TuneFlow.Player.PlayMusicInfo['musicInfo'] | null
  /**
   * 当前播放歌曲的列表 id
   */
  listId: TuneFlow.Player.PlayMusicInfo['listId'] | null
  /**
   * 是否属于 “稍后播放”
   */
  isTempPlay: boolean
}>({
  listId: null,
  musicInfo: null,
  isTempPlay: false,
})
export const playInfo = shallowReactive<TuneFlow.Player.PlayInfo>({
  playIndex: -1,
  playerListId: null,
  playerPlayIndex: -1,
})


export const playedList = window.tuneFlowData.playedList = shallowReactive<TuneFlow.Player.PlayMusicInfo[]>([])

export const tempPlayList = shallowReactive<TuneFlow.Player.PlayMusicInfo[]>([])

window.tuneFlowData.playInfo = playInfo
window.tuneFlowData.playMusicInfo = playMusicInfo
