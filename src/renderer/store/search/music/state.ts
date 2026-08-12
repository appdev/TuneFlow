import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

// import { deduplicationList } from '@common/utils/renderer'

export declare interface ListInfo {
  list: TuneFlow.Music.MusicInfo[]
  total: number
  page: number
  maxPage: number
  limit: number
  key: string | null
  noItemLabel: string
}

interface ListInfos extends Partial<Record<TuneFlow.OnlineSource, ListInfo>> {
  'all': ListInfo
}

export const sources: Array<TuneFlow.OnlineSource | 'all'> = markRaw([])

export const listInfos: ListInfos = markRaw({
  all: reactive<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  }),
})
export const maxPages: Partial<Record<TuneFlow.OnlineSource, number>> = {}
for (const source of music.sources) {
  if (!music[source.id as TuneFlow.OnlineSource]?.musicSearch) continue
  sources.push(source.id as TuneFlow.OnlineSource)
  listInfos[source.id as TuneFlow.OnlineSource] = reactive<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: '',
    noItemLabel: '',
  })
  maxPages[source.id as TuneFlow.OnlineSource] = 0
}
sources.push('all')
