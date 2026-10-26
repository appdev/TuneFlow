import RNFS from 'react-native-fs'

import { LIST_IDS } from '@/config/constant'
import { playNext, togglePlay } from '@/core/player/player'
import playerActions from '@/store/player/action'
import playerState from '@/store/player/state'
import { needsSharedFileAccess } from '@/utils/nativeModules/utils'
import { requestStoragePermission } from '@/utils/tools'
import { getDownloadTask } from './store'

export const playDownloadTask = async(id: string) => {
  const task = getDownloadTask(id)
  if (task?.status != 'completed' || !task.filePath) throw new Error('download_play_missing')
  const filePath = task.filePath
  const current = playerState.playMusicInfo.musicInfo
  if (current && !('progress' in current) && current.source == 'local' && current.meta.filePath == filePath && playerState.isPlay) {
    togglePlay()
    return
  }
  if (await needsSharedFileAccess(filePath) && !await requestStoragePermission()) throw new Error('storage_all_files_unconfirmed')
  if (!await RNFS.exists(filePath) || getDownloadTask(id) !== task) throw new Error('download_play_missing')
  if (current === playerState.playMusicInfo.musicInfo && current && !('progress' in current) && current.source == 'local' && current.meta.filePath == filePath) {
    togglePlay()
    return
  }
  // 只传本地文件信息，避免在线歌曲的换源信息使离线播放重新请求音源。
  const musicInfo: LX.Music.MusicInfoLocal = {
    id: filePath,
    source: 'local',
    name: task.musicInfo.name,
    singer: task.musicInfo.singer,
    interval: task.musicInfo.interval,
    meta: {
      songId: filePath,
      filePath,
      ext: task.fileName.split('.').pop()?.toLowerCase() ?? '',
      albumName: task.musicInfo.meta.albumName,
      picUrl: task.musicInfo.meta.picUrl,
    },
  }
  playerActions.addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo, isTop: true }])
  await playNext()
}
