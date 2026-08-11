import { filterMusicList } from '@common/utils/filterPlayerList'
import { createSortedList, filterDuplicateMusic, searchListMusic, sortListMusicInfo } from '@common/utils/musicList'
import { tranditionalize } from '../renderer/utils/simplify-chinese-main/index.js'

const unsupportedOperation = (name: string | symbol) => async() => {
  throw Object.assign(
    new Error(`Worker operation '${String(name)}' is not available in the web runtime`),
    { code: 'UNSUPPORTED_CAPABILITY' as const },
  )
}

export interface MainTypes {
  filterMusicList: typeof filterMusicList
  sortListMusicInfo: typeof sortListMusicInfo
  filterDuplicateMusic: typeof filterDuplicateMusic
  searchListMusic: typeof searchListMusic
  createSortedList: typeof createSortedList
  langS2t: (textBase64: string) => Promise<string>
}

export type DownloadTypes = Record<string, (...args: any[]) => Promise<never>>

const mainWorker: MainTypes = {
  filterMusicList,
  sortListMusicInfo,
  filterDuplicateMusic,
  searchListMusic,
  createSortedList,
  langS2t: async textBase64 => Buffer.from(tranditionalize(Buffer.from(textBase64, 'base64').toString())).toString('base64'),
}
const downloadWorker = new Proxy({}, { get: (_target, name) => unsupportedOperation(name) }) as DownloadTypes

export const proxyCallback = <Args extends any[]>(callback: (...args: Args) => void) => callback

export const createWebWorkers = () => ({
  main: mainWorker,
  download: downloadWorker,
})

export default createWebWorkers
