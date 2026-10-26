import { reactive } from '@common/utils/vueTools'

export {
  allMusicList,
  defaultList,
  loveList,
  localList,
  tempList,
  userLists,
} from '@renderer/store/list/listManage'
// import { reactive, ref, markRaw, Ref } from '@common/utils/vueTools'

// // const TEMP_LIST = 'TEMP_LIST'

// export const isInitedList: Ref<boolean> = ref(false)

// export const allList: Map<string, TuneFlow.Music.MusicInfo[]> = window.tuneFlowData.allList = markRaw(new Map())

// export const defaultList: Omit<TuneFlow.List.MyDefaultListInfo, 'list'> = reactive({
//   id: 'default',
//   name: '试听列表',
// })

// export const loveList: Omit<TuneFlow.List.MyLoveListInfo, 'list'> = reactive({
//   id: 'love',
//   name: '我的收藏',
// })

// export const tempList: Omit<TuneFlow.List.MyTempListInfo, 'list'> = reactive({
//   id: 'temp',
//   name: '临时列表',
//   meta: {},
// })

export const tempListMeta = {
  id: '',
}


// export const userLists: TuneFlow.List.UserListInfo[] = window.tuneFlowData.userLists = reactive([])

export const fetchingListStatus = reactive<Record<string, boolean>>({})

export const listUpdateTimes = reactive<Record<string, string>>({})
