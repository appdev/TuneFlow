import { updateListMusics } from '@renderer/store/list/action'
import { saveLyric } from '@renderer/utils/ipc'
import { fetchServiceLyric, fetchServicePicture } from '@web-runtime/lyrics'

import {
  buildLyricInfo,
  getCachedLyricInfo,
  getOtherSource,
} from './utils'


const getOtherSourceByLocal = async<T>(musicInfo: TuneFlow.Music.MusicInfoLocal, handler: (infos: TuneFlow.Music.MusicInfoOnline[]) => Promise<T>) => {
  let result: TuneFlow.Music.MusicInfoOnline[] = []
  result = await getOtherSource(musicInfo)
  if (result.length) try { return await handler(result) } catch {}
  if (musicInfo.name.includes('-')) {
    const [name, singer] = musicInfo.name.split('-').map(val => val.trim())
    result = await getOtherSource({
      ...musicInfo,
      name,
      singer,
    }, true)
    if (result.length) try { return await handler(result) } catch {}
    result = await getOtherSource({
      ...musicInfo,
      name: singer,
      singer: name,
    }, true)
    if (result.length) try { return await handler(result) } catch {}
  }
  let fileName = musicInfo.meta.filePath?.split(/\/|\\/).at(-1)
  if (fileName) {
    fileName = fileName.substring(0, fileName.lastIndexOf('.'))
    if (fileName != musicInfo.name) {
      if (fileName.includes('-')) {
        const [name, singer] = fileName.split('-').map(val => val.trim())
        result = await getOtherSource({
          ...musicInfo,
          name,
          singer,
        }, true)
        if (result.length) try { return await handler(result) } catch {}
        result = await getOtherSource({
          ...musicInfo,
          name: singer,
          singer: name,
        }, true)
      } else {
        result = await getOtherSource({
          ...musicInfo,
          name: fileName,
          singer: '',
        }, true)
      }
      if (result.length) try { return await handler(result) } catch {}
    }
  }

  throw new Error('source not found')
}

export const getMusicUrl = async({ musicInfo }: {
  musicInfo: TuneFlow.Music.MusicInfoLocal
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: TuneFlow.Music.MusicInfoOnline) => void
}): Promise<string> => {
  return `/api/v1/library/tracks/${encodeURIComponent(musicInfo.id)}/stream`
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, onToggleSource = () => {} }: {
  musicInfo: TuneFlow.Music.MusicInfoLocal
  listId?: string | null
  isRefresh: boolean
  onToggleSource?: (musicInfo?: TuneFlow.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    if (musicInfo.meta.picUrl) return musicInfo.meta.picUrl
  }
  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async(otherSource) => {
    let lastError: unknown = new Error('picture source not found')
    for (const target of otherSource) {
      try {
        const url = await fetchServicePicture(target)
        if (listId) {
          musicInfo.meta.picUrl = url
          void updateListMusics([{ id: listId, musicInfo }])
        }
        return url
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: TuneFlow.Music.MusicInfoLocal
  isRefresh: boolean
  onToggleSource?: (musicInfo?: TuneFlow.Music.MusicInfoOnline) => void
}): Promise<TuneFlow.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
  }
  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async(otherSource) => {
    let lastError: unknown = new Error('lyric source not found')
    for (const target of otherSource) {
      try {
        const lyricInfo = await fetchServiceLyric(target)
        void saveLyric(musicInfo, lyricInfo)
        void saveLyric(target, lyricInfo)
        return buildLyricInfo(lyricInfo)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  })
}
