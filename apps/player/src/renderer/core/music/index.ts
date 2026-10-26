// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'

import { findLocalPlayback } from './preferLocal'
import { appSetting } from '@renderer/store/setting'
import { requestMsg } from '@renderer/utils/message'
import { getServiceProvenance, resolveServiceTrack, serviceLyrics } from '@renderer/service/tracks'
import { ServiceClient } from '@renderer/service/client'
export { isCustomApiSource } from './utils'

export interface MusicUrlResolvedInfo {
  requestedSource: LX.Source
  resolvedSource: LX.Source
  quality: LX.Quality | null
  mode: 'official' | 'api' | 'fallback' | 'cache' | 'local' | 'download' | 'service'
  isFallback?: boolean
  routeKey?: string
  resolvedMusicInfo?: LX.Music.MusicInfo
  officialReportSongId?: string
  cacheProviderId?: string
}

export interface MusicUrlRequestOptions {
  /** all 会遵循设置中的自定义 API 优先策略；显式值用于单次线路尝试。 */
  routeStrategy?: 'all' | 'official' | 'api'
  excludedUrls?: ReadonlySet<string>
  excludedRouteKeys?: ReadonlySet<string>
  refreshRouteKeys?: ReadonlySet<string>
  onRouteFailed?: (routeKey: string, url?: string) => void
  onRouteRateLimited?: (routeKey: string) => void
  blockedApiProviders?: Map<string, Error>
  signal?: AbortSignal
  directOnly?: boolean
}


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  onResolved,
  allowToggleSource,
  requestOptions,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onResolved?: (info: MusicUrlResolvedInfo) => void
  allowToggleSource?: boolean
  requestOptions?: MusicUrlRequestOptions
}): Promise<string> => {
  const service = getServiceProvenance(musicInfo)
  if (service) {
    const resolved = await resolveServiceTrack(service, quality ?? appSetting['player.playQuality'], requestOptions?.signal)
    if (requestOptions?.signal?.aborted) throw new Error(requestMsg.cancelRequest)
    if (requestOptions?.excludedUrls?.has(resolved.url)) throw new Error('服务器未提供新的可播放线路')
    const source = 'source' in musicInfo ? musicInfo.source : musicInfo.metadata.musicInfo.source
    onResolved?.({ requestedSource: source, resolvedSource: source, quality: resolved.quality, mode: 'service' })
    return resolved.url
  }
  if ('progress' in musicInfo) {
    return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, onResolved, allowToggleSource, requestOptions })
  } else if (musicInfo.source == 'local') {
    return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, onResolved, allowToggleSource, requestOptions })
  } else {
    if (appSetting['player.preferLocal'] && !isRefresh) {
      const local = await findLocalPlayback(musicInfo, quality ?? appSetting['player.playQuality'], requestOptions).catch(() => null)
      if (requestOptions?.signal?.aborted) throw new Error(requestMsg.cancelRequest)
      if (local) { onResolved?.(local.info); return local.url }
    }
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, onResolved, allowToggleSource, requestOptions })
  }
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  const service = getServiceProvenance(musicInfo)
  if (service) {
    const client = new ServiceClient(service.endpoint)
    if (service.picturePath) return client.resourceUrl(service.picturePath)
    if (service.streamPath) return ''
    const result = await client.picture(service.track)
    return /^https?:\/\//.test(result.url) ? result.url : client.resourceUrl(result.url)
  }
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  const service = getServiceProvenance(musicInfo)
  if (service) {
    const client = new ServiceClient(service.endpoint)
    return serviceLyrics(service.lyricsPath
      ? await client.request(service.lyricsPath)
      : await client.lyrics(service.track))
  }
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
