import { toRaw } from '@common/utils/vueTools'
import { rendererInvoke, rendererOff, rendererOn } from '@web-runtime/rendererIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import {
  userListCreate,
  listDataOverwrite,
  userListsRemove,
  userListsUpdate,
  userListsUpdatePosition,
  listMusicAdd,
  listMusicMove,
  listMusicRemove,
  listMusicOverwrite,
  listMusicUpdateInfo,
  listMusicUpdatePosition,
  setMusicList,
  setUserLists,
  listMusicClear,
} from './action'
import { allMusicList } from './state'
import { LIST_IDS } from '@common/constants'

/**
 * 获取用户列表
 * @returns 所有用户列表
 */
export const getUserLists = async() => {
  const lists = await rendererInvoke<TuneFlow.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get)
  return setUserLists(lists)
}

/**
 * 添加用户列表
 * @param data
 */
export const createUserList = async(data: TuneFlow.List.ListActionAdd) => {
  data.listInfos = data.listInfos.map(info => toRaw(info))
  await rendererInvoke<TuneFlow.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, data)
}

/**
 * 移除用户列表及列表内歌曲
 * @param data
 */
export const removeUserList = async(data: TuneFlow.List.ListActionRemove) => {
  await rendererInvoke<TuneFlow.List.ListActionRemove>(PLAYER_EVENT_NAME.list_remove, data)
}

/**
 * 更新用户列表
 * @param data
 */
export const updateUserList = async(data: TuneFlow.List.ListActionUpdate) => {
  data = data.map(info => toRaw(info))
  await rendererInvoke<TuneFlow.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, data)
}

/**
 * 批量移动用户列表位置
 * @param data
 */
export const updateUserListPosition = async(data: TuneFlow.List.ListActionUpdatePosition) => {
  await rendererInvoke<TuneFlow.List.ListActionUpdatePosition>(PLAYER_EVENT_NAME.list_update_position, data)
}

/**
 * 获取列表内的歌曲
 * @param listId
 */
export const getListMusics = async(listId: string | null): Promise<TuneFlow.Music.MusicInfo[]> => {
  if (!listId) return []
  if (listId == LIST_IDS.LOCAL) {
    const list = await rendererInvoke<string, TuneFlow.Music.MusicInfo[]>(PLAYER_EVENT_NAME.list_music_get, listId)
    return setMusicList(listId, list)
  }
  if (allMusicList.has(listId)) return allMusicList.get(listId)!
  const list = await rendererInvoke<string, TuneFlow.Music.MusicInfo[]>(PLAYER_EVENT_NAME.list_music_get, listId)
  return setMusicList(listId, list)
}

/**
 * 批量添加歌曲到列表
 * @param data
 */
export const addListMusics = async(data: TuneFlow.List.ListActionMusicAdd) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicAdd>(PLAYER_EVENT_NAME.list_music_add, data)
}

/**
 * 跨列表批量移动歌曲
 * @param data
 */
export const moveListMusics = async(data: TuneFlow.List.ListActionMusicMove) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicMove>(PLAYER_EVENT_NAME.list_music_move, data)
}

/**
 * 批量删除列表内歌曲
 * @param data
 */
export const removeListMusics = async(data: TuneFlow.List.ListActionMusicRemove) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicRemove>(PLAYER_EVENT_NAME.list_music_remove, data)
}

/**
 * 批量更新列表内歌曲
 * @param data
 */
export const updateListMusics = async(data: TuneFlow.List.ListActionMusicUpdate) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicUpdate>(PLAYER_EVENT_NAME.list_music_update, data)
}

/**
 * 批量移动列表内歌曲的位置
 * @param data
 */
export const updateListMusicsPosition = async(data: TuneFlow.List.ListActionMusicUpdatePosition) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicUpdatePosition>(PLAYER_EVENT_NAME.list_music_update_position, data)
}

/**
 * 覆盖列表内的歌曲
 * @param data
 */
export const overwriteListMusics = async(data: TuneFlow.List.ListActionMusicOverwrite) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicOverwrite>(PLAYER_EVENT_NAME.list_music_overwrite, data)
}

/**
 * 清空列表内的歌曲
 * @param ids
 */
export const clearListMusics = async(ids: TuneFlow.List.ListActionMusicClear) => {
  await rendererInvoke<TuneFlow.List.ListActionMusicClear>(PLAYER_EVENT_NAME.list_music_clear, ids)
}

/**
 * 覆盖全部列表数据
 * @param data
 */
export const overwriteListFull = async(data: TuneFlow.List.ListActionDataOverwrite) => {
  data.defaultList = toRaw(data.defaultList)
  data.loveList = toRaw(data.loveList)
  if (data.tempList) {
    data.tempList = toRaw(data.tempList)
  }
  data.userList = data.userList.map(info => {
    return {
      ...info,
      list: toRaw(info.list),
    }
  })

  await rendererInvoke<TuneFlow.List.ListActionDataOverwrite>(PLAYER_EVENT_NAME.list_data_overwire, data)
}

/**
 * 检查音乐是否存在列表中
 * @param listId
 * @param musicInfoId
 */
export const checkListExistMusic = async(listId: string, musicInfoId: string): Promise<boolean> => {
  return rendererInvoke<TuneFlow.List.ListActionCheckMusicExistList, boolean>(PLAYER_EVENT_NAME.list_music_check_exist, { listId, musicInfoId })
}

/**
 * 获取所有存在该音乐的列表id
 * @param musicInfoId
 */
export const getMusicExistListIds = async(musicInfoId: string): Promise<string[]> => {
  return rendererInvoke<string, string[]>(PLAYER_EVENT_NAME.list_music_get_list_ids, musicInfoId)
}


const noop = () => {}


export const registerListAction = (appSetting: TuneFlow.AppSetting, onListChanged: (listIds: string[]) => void = noop) => {
  const list_data_overwrite = ({ params: datas }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionDataOverwrite>) => {
    const updatedListIds = listDataOverwrite(datas)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_create = ({ params: { position, listInfos } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionAdd>) => {
    for (const list of listInfos) {
      userListCreate({ ...list, position })
    }
  }
  const list_remove = ({ params: ids }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionRemove>) => {
    const updatedListIds = userListsRemove(ids)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_update = ({ params: listInfos }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionUpdate>) => {
    userListsUpdate(listInfos)
  }
  const list_update_position = ({ params: { position, ids } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionUpdatePosition>) => {
    userListsUpdatePosition(position, ids)
  }
  const list_music_add = ({ params: { id, musicInfos, addMusicLocationType } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicAdd>) => {
    addMusicLocationType ??= appSetting['list.addMusicLocationType']
    const updatedListIds = listMusicAdd(id, musicInfos, addMusicLocationType)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_move = ({ params: { fromId, toId, musicInfos, addMusicLocationType } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicMove>) => {
    addMusicLocationType ??= appSetting['list.addMusicLocationType']
    const updatedListIds = listMusicMove(fromId, toId, musicInfos, addMusicLocationType)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_remove = ({ params: { listId, ids } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicRemove>) => {
    // console.log(listId, ids)
    const updatedListIds = listMusicRemove(listId, ids)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_update = ({ params: musicInfos }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicUpdate>) => {
    const updatedListIds = listMusicUpdateInfo(musicInfos)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_update_position = ({ params: { listId, position, ids } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicUpdatePosition>) => {
    void listMusicUpdatePosition(listId, position, ids).then(updatedListIds => {
      if (updatedListIds.length) onListChanged(updatedListIds)
    })
  }
  const list_music_overwrite = ({ params: { listId, musicInfos } }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicOverwrite>) => {
    const updatedListIds = listMusicOverwrite(listId, musicInfos)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_clear = ({ params: ids }: TuneFlow.IpcRendererEventParams<TuneFlow.List.ListActionMusicClear>) => {
    const updatedListIds = listMusicClear(ids)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }

  rendererOn(PLAYER_EVENT_NAME.list_data_overwire, list_data_overwrite)
  rendererOn(PLAYER_EVENT_NAME.list_add, list_create)
  rendererOn(PLAYER_EVENT_NAME.list_remove, list_remove)
  rendererOn(PLAYER_EVENT_NAME.list_update, list_update)
  rendererOn(PLAYER_EVENT_NAME.list_update_position, list_update_position)
  rendererOn(PLAYER_EVENT_NAME.list_music_add, list_music_add)
  rendererOn(PLAYER_EVENT_NAME.list_music_move, list_music_move)
  rendererOn(PLAYER_EVENT_NAME.list_music_remove, list_music_remove)
  rendererOn(PLAYER_EVENT_NAME.list_music_update, list_music_update)
  rendererOn(PLAYER_EVENT_NAME.list_music_update_position, list_music_update_position)
  rendererOn(PLAYER_EVENT_NAME.list_music_overwrite, list_music_overwrite)
  rendererOn(PLAYER_EVENT_NAME.list_music_clear, list_music_clear)

  return () => {
    rendererOff(PLAYER_EVENT_NAME.list_data_overwire, list_data_overwrite)
    rendererOff(PLAYER_EVENT_NAME.list_add, list_create)
    rendererOff(PLAYER_EVENT_NAME.list_remove, list_remove)
    rendererOff(PLAYER_EVENT_NAME.list_update, list_update)
    rendererOff(PLAYER_EVENT_NAME.list_update_position, list_update_position)
    rendererOff(PLAYER_EVENT_NAME.list_music_add, list_music_add)
    rendererOff(PLAYER_EVENT_NAME.list_music_move, list_music_move)
    rendererOff(PLAYER_EVENT_NAME.list_music_remove, list_music_remove)
    rendererOff(PLAYER_EVENT_NAME.list_music_update, list_music_update)
    rendererOff(PLAYER_EVENT_NAME.list_music_update_position, list_music_update_position)
    rendererOff(PLAYER_EVENT_NAME.list_music_overwrite, list_music_overwrite)
    rendererOff(PLAYER_EVENT_NAME.list_music_clear, list_music_clear)
  }
}
