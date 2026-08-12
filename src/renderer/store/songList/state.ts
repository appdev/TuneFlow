import { reactive, markRaw, ref, shallowReactive } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

export interface SortInfo {
  name: string
  id: string
}

export const sources: TuneFlow.OnlineSource[] = markRaw([])
export const sortList = markRaw<Partial<Record<TuneFlow.OnlineSource, SortInfo[]>>>({})

for (const source of music.sources) {
  const songList = music[source.id as TuneFlow.OnlineSource]?.songList
  if (!songList) continue
  sources.push(source.id as TuneFlow.OnlineSource)
  sortList[source.id as TuneFlow.OnlineSource] = songList.sortList as SortInfo[]
}

export interface TagInfoItem<T extends TuneFlow.OnlineSource = TuneFlow.OnlineSource> {
  parent_id: string
  parent_name: string
  id: string
  name: string
  source: T
}
export interface TagInfoTypeItem<T extends TuneFlow.OnlineSource = TuneFlow.OnlineSource> {
  name: string
  list: Array<TagInfoItem<T>>
}
export interface TagInfo<Source extends TuneFlow.OnlineSource = TuneFlow.OnlineSource> {
  tags: Array<TagInfoTypeItem<Source>>
  hotTag: Array<TagInfoItem<Source>>
  source: Source
}

type Tags = Partial<Record<TuneFlow.OnlineSource, TagInfo>>

export const tags = shallowReactive<Tags>({})


export interface ListInfoItem {
  play_count: string
  id: string
  author: string
  name: string
  time?: string
  img: string
  // grade: basic.favorcnt / 10,
  desc: string | null
  source: TuneFlow.OnlineSource
  total?: string
}
export interface ListInfo {
  list: ListInfoItem[]
  total: number
  page: number
  limit: number
  key: string | null
  noItemLabel: string
  source?: TuneFlow.OnlineSource
  tagId: string
  sortId: string
}

export interface ListDetailInfo {
  list: TuneFlow.Music.MusicInfoOnline[]
  source: TuneFlow.OnlineSource
  desc: string | null
  total: number
  page: number
  limit: number
  key: string | null
  id: string
  info: {
    name?: string
    img?: string
    desc?: string
    author?: string
    play_count?: string
  }
  noItemLabel: string
}

export const listInfo = reactive<ListInfo>({
  list: [],
  total: 0,
  page: 1,
  limit: 30,
  key: null,
  noItemLabel: '',
  source: 'kw',
  tagId: '',
  sortId: '',
})

export const listDetailInfo = reactive<ListDetailInfo>({
  list: [],
  id: '',
  desc: null,
  total: 0,
  page: 1,
  limit: 30,
  key: null,
  source: 'kw',
  info: {},
  noItemLabel: '',
})

export const selectListInfo = markRaw<ListInfoItem>({
  play_count: '',
  id: '',
  author: '',
  name: '',
  time: '',
  img: '',
  // grade: basic.favorcnt / 10,
  desc: '',
  source: 'kw',
})

export const isVisibleListDetail = ref(false)
export const openSongListInputInfo = markRaw({
  text: '',
  source: '',
})
