import { filterMusicList, sortListMusicInfo, filterDuplicateMusic, searchListMusic, createSortedList, exportPlayListToText, exportPlayListToCSV } from '@renderer/worker/main/list'
import { langS2t } from '@renderer/worker/main/common'
import { saveLxConfigFile, readLxConfigFile, saveStrToFile } from '@web-runtime/files'
import { unavailable } from '@web-runtime/unavailable'
export const proxyCallback = <T>(callback: T) => callback
export default () => ({ main: { filterMusicList, sortListMusicInfo, filterDuplicateMusic, searchListMusic, createSortedList, exportPlayListToText, exportPlayListToCSV, langS2t, saveLxConfigFile, readLxConfigFile, saveStrToFile }, download: new Proxy({}, { get: () => async() => unavailable('本机下载；请使用服务器下载') }) })
