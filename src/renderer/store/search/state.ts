import { ref, shallowReactive } from '@common/utils/vueTools'


export const searchText = ref('')

export type onlineSource = TuneFlow.OnlineSource


export const historyList = shallowReactive<string[]>([])
