import { existsSync } from 'node:fs'
import path from 'node:path'
import { QUALITYS } from '../../common/constants'
import type { DownloadExtension, DownloadFileNamePattern } from './types'

const invalidCharacters = /[\\/:*?#"<>|]/g

export const getExt = (quality: string): DownloadExtension => {
  switch (quality) {
    case 'ape': return 'ape'
    case 'flac':
    case 'flac24bit': return 'flac'
    case 'wav': return 'wav'
    default: return 'mp3'
  }
}

export const getMusicType = (musicInfo: TuneFlow.Music.MusicInfoOnline, requested: TuneFlow.Quality, qualityList?: TuneFlow.QualityList): TuneFlow.Quality => {
  return getMusicTypes(musicInfo, requested, qualityList)[0]
}

export const getMusicTypes = (musicInfo: TuneFlow.Music.MusicInfoOnline, requested: TuneFlow.Quality, qualityList?: TuneFlow.QualityList): TuneFlow.Quality[] => {
  const start = Math.max(0, QUALITYS.indexOf(requested))
  const sourceQualitys = qualityList?.[musicInfo.source]
  const candidates = QUALITYS.slice(start).filter(quality =>
    musicInfo.meta._qualitys[quality] != null && (sourceQualitys == null || sourceQualitys.includes(quality)),
  )
  return candidates.length > 0 ? [...candidates] : ['128k']
}

const clipSinger = (singer: string): string => {
  if (singer.length <= 80 || !singer.includes('、')) return singer
  const names = singer.split('、')
  let result = names.shift() ?? ''
  for (const name of names) {
    if (result.length + name.length > 80) break
    result += `、${name}`
  }
  return result
}

export const makeFileName = (pattern: DownloadFileNamePattern | string, name: string, singer: string, extension: DownloadExtension): string => {
  const basename = pattern.replace('歌手', clipSinger(singer)).replace('歌名', name).slice(0, 150).replace(invalidCharacters, '') || 'untitled'
  return `${basename}.${extension}`
}

export const makeDirectoryName = (name: string, fallback = 'Default'): string => {
  const sanitized = name.slice(0, 150).replace(invalidCharacters, '').trim()
  return sanitized === '' || sanitized === '.' || sanitized === '..' ? fallback : sanitized
}

export const reserveFileName = (directory: string, requested: string, additionallyReserved: ReadonlySet<string> = new Set()): string => {
  const extension = path.extname(requested)
  const basename = requested.slice(0, -extension.length)
  let candidate = requested
  let suffix = 0
  while (existsSync(path.join(directory, candidate)) || additionallyReserved.has(candidate)) {
    suffix++
    candidate = `${basename} (${suffix})${extension}`
  }
  return candidate
}
