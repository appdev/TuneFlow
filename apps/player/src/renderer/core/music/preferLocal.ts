import { getDownloadList } from '@renderer/store/download/action'
import { getListMusics } from '@renderer/store/list/action'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { getDownloadFilePath, getLocalFilePath } from '@renderer/utils/music'
import { buildSavePath } from '@renderer/store/download/utils'
import { isSameLocalRecording, isSamePlatformTrack } from '@common/utils/localTrackMatch'
import type { MusicUrlRequestOptions, MusicUrlResolvedInfo } from './index'

export const findLocalPlayback = async(music: LX.Music.MusicInfoOnline, quality?: LX.Quality, options?: MusicUrlRequestOptions) => {
  const tasks = (await getDownloadList()).filter(task => task.isComplate && isSamePlatformTrack(music, task.metadata.musicInfo))
  tasks.sort((a, b) => Number(b.metadata.quality == quality) - Number(a.metadata.quality == quality))
  for (const task of tasks) {
    const url = await getDownloadFilePath(task, buildSavePath(task)).catch(() => '')
    const routeKey = `download:${music.source}:${task.id}`
    if (!url || options?.excludedUrls?.has(url) == true || options?.excludedRouteKeys?.has(routeKey) == true) continue
    const info: MusicUrlResolvedInfo = { requestedSource: music.source, resolvedSource: music.source, quality: task.metadata.quality, mode: 'download', resolvedMusicInfo: music, routeKey }
    return { url, info }
  }
  for (const list of [defaultList, loveList, ...userLists]) {
    for (const candidate of await getListMusics(list.id)) {
      if (candidate.source != 'local' || !isSameLocalRecording(music, candidate)) continue
      const url = await getLocalFilePath(candidate).catch(() => '')
      const routeKey = `local:${candidate.id}`
      if (!url || options?.excludedUrls?.has(url) == true || options?.excludedRouteKeys?.has(routeKey) == true) continue
      const info: MusicUrlResolvedInfo = { requestedSource: music.source, resolvedSource: music.source, quality: null, mode: 'local', resolvedMusicInfo: candidate, routeKey }
      return { url, info }
    }
  }
  return null
}
