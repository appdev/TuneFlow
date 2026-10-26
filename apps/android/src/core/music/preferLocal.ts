import RNFS from 'react-native-fs'
import { getDownloadTasks } from '@/core/download/store'
import { getListMusics } from '@/core/list'
import listState from '@/store/list/state'
import { getLocalFilePath } from '@/utils/music'
import { isSameLocalRecording, isSamePlatformTrack } from '@/utils/localTrackMatch'

export const findLocalPlayback = async(music: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  const tasks = getDownloadTasks().filter(task => task.status == 'completed' && task.filePath && isSamePlatformTrack(music, task.musicInfo))
  tasks.sort((a, b) => Number(b.quality == quality) - Number(a.quality == quality))
  for (const task of tasks) {
    if (await RNFS.exists(task.filePath!).catch(() => false)) return { url: task.filePath!, quality: task.quality }
  }
  for (const list of [listState.defaultList, listState.loveList, ...listState.userList]) {
    for (const candidate of await getListMusics(list.id)) {
      if (candidate.source != 'local' || !isSameLocalRecording(music, candidate)) continue
      const url = await getLocalFilePath(candidate).catch(() => '')
      if (url) return { url, quality }
    }
  }
  return null
}
