import { installServiceCatalog } from '@renderer/service/workspace'
import { getWorkspace } from '@renderer/service/session'
const list = [{ id: 'kw', name: '酷我音乐' }, { id: 'kg', name: '酷狗音乐' }, { id: 'tx', name: 'QQ音乐' }, { id: 'wy', name: '网易云音乐' }, { id: 'mg', name: '咪咕音乐' }]
// The shared browse page needs the same sort contract as the native SDK.
// Network operations are still installed exclusively from the Docker adapter.
const sorts: Record<string, Array<{ id: string, name: string }>> = {
  kw: [{ id: 'new', name: '最新' }, { id: 'hot', name: '最热' }],
  kg: [{ id: '5', name: '推荐' }, { id: '6', name: '最热' }, { id: '7', name: '最新' }, { id: '3', name: '热藏' }, { id: '8', name: '飙升' }],
  tx: [{ id: '5', name: '最热' }, { id: '2', name: '最新' }],
  wy: [{ id: 'hot', name: '最热' }],
  mg: [{ id: '15127315', name: '推荐' }],
}
const sources: any = { sources: list }
for (const { id } of list) sources[id] = { musicSearch: { limit: 30 }, songList: { sortList: sorts[id] }, leaderboard: {} }
installServiceCatalog(sources, getWorkspace)
export default { ...sources, init: async() => {}, supportQuality: {} }
