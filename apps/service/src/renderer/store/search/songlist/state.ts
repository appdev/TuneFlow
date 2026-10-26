import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

// import { deduplicationList } from '@common/utils/renderer'

import { type ListInfo } from '@renderer/store/songList/state'

export type { ListInfoItem } from '@renderer/store/songList/state'

export const sources: Array<TuneFlow.OnlineSource | 'all'> = markRaw([])

export type SearchListInfo = Omit<ListInfo, 'source'>


interface ListInfos extends Partial<Record<TuneFlow.OnlineSource, SearchListInfo>> {
  'all': SearchListInfo
}


export const listInfos: ListInfos = markRaw({
  all: reactive<SearchListInfo>({
    page: 1,
    limit: 15,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  }),
})
export const maxPages: Partial<Record<TuneFlow.OnlineSource, number>> = {}
for (const source of music.sources) {
  if (!music[source.id as TuneFlow.OnlineSource]?.songList?.search) continue
  sources.push(source.id as TuneFlow.OnlineSource)
  listInfos[source.id as TuneFlow.OnlineSource] = reactive<SearchListInfo>({
    page: 1,
    limit: 18,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  })
  maxPages[source.id as TuneFlow.OnlineSource] = 0
}
sources.push('all')
