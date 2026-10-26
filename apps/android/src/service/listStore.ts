import { onServiceLists, startServiceSession, subscribeService, serviceStatus } from './session'
import { allMusicList, setUserLists, setMusicList } from '@/utils/listManage'
import { setUserList, setActiveList } from '@/core/list'
import listState from '@/store/list/state'
import { LIBRARY_ID } from './workspace'
import searchMusicState from '@/store/search/music/state'
import searchSonglistState from '@/store/search/songlist/state'
import { clearServiceSonglistCache } from '@/core/songlist'
import { clearServiceLeaderboardCache } from '@/core/leaderboard'
import { setPlayMusicInfo, setPlayListId } from '@/core/player/playInfo'
import { clearTempPlayeList } from '@/core/player/tempPlayList'
import { clearPlayedList } from '@/core/player/playedList'

let initialized = false
export const initServiceLists = () => {
  if (initialized) return
  initialized = true
  let endpoint = serviceStatus.endpoint
  subscribeService(() => {
    if (endpoint === serviceStatus.endpoint) return
    endpoint = serviceStatus.endpoint
    clearServiceSonglistCache(); clearServiceLeaderboardCache()
    searchMusicState.searchText = ''; searchSonglistState.searchText = ''
    for (const item of Object.values(searchMusicState.listInfos)) { item.list = []; item.key = null; item.page = 1 }
    for (const item of Object.values(searchSonglistState.listInfos)) { item.list = []; item.key = null; item.page = 1 }
    allMusicList.clear()
    clearTempPlayeList(); clearPlayedList(); setPlayListId(null); setPlayMusicInfo(null, null)
  })
  onServiceLists(data => {
    if (data.tempList) { setMusicList('temp', data.tempList); global.app_event.myListMusicUpdate(['temp']); return }
    const previous = [...allMusicList.keys()]
    // In-memory view only: do not call the legacy persistence/sync handlers.
    for (const id of previous) if (id !== 'temp') allMusicList.delete(id)
    const lists = data.userList.map(({ list, ...info }: LX.List.UserListInfoFull) => { setMusicList(info.id, list); return info })
    setMusicList('default', data.defaultList); setMusicList('love', data.loveList)
    setUserLists(lists); setUserList(lists)
    if (!['default', 'love', ...lists.map((item: { id: string }) => item.id)].includes(listState.activeListId)) setActiveList(lists.length ? LIBRARY_ID : 'default')
    global.app_event.myListMusicUpdate([...new Set([...previous, 'default', 'love', ...lists.map((item: { id: string }) => item.id)])])
  })
  startServiceSession()
}
