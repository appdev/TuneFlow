import { reactive, markRaw, shallowReactive } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

export type Source = TuneFlow.OnlineSource

export const sources: TuneFlow.OnlineSource[] = markRaw([])

for (const source of music.sources) {
  if (!music[source.id as TuneFlow.OnlineSource]?.leaderboard?.getBoards) continue
  sources.push(source.id as TuneFlow.OnlineSource)
}

export interface BoardItem {
  id: string
  name: string
  bangid: string
}
export interface Board {
  list: BoardItem[]
  source: TuneFlow.OnlineSource
}
type Boards = Partial<Record<TuneFlow.OnlineSource, Board>>

export const boards = shallowReactive<Boards>({})

export interface ListDetailInfo {
  list: TuneFlow.Music.MusicInfoOnline[]
  total: number
  page: number
  source: TuneFlow.OnlineSource | null
  limit: number
  key: string | null
  id: string
  noItemLabel: string
}

export const listDetailInfo = reactive<ListDetailInfo>({
  list: [],
  total: 0,
  page: 1,
  limit: 30,
  key: null,
  source: null,
  id: '',
  noItemLabel: '',
})

