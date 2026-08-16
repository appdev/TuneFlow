import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import { buildLyrics } from '@common/utils/musicMeta/buildLyrics'
import type { DownloadJobRecord } from './types'
import { writeAudioMetadata } from './taglibMetadata'
import type { AudioMetadata } from './taglibMetadata'

export interface MetadataDependencies {
  pictureBytes?: Uint8Array
  pictureMimeType?: string
  lyrics?: TuneFlow.Music.LyricInfo
  writeAudioMetadata?: (filePath: string, meta: AudioMetadata) => Promise<void>
  lyricFilePath?: string
}

export interface MetadataWriteResult {
  warnings: string[]
}

const fixKgLyric = (lrc: string): string => /\[00:\d\d:\d\d.\d+\]/.test(lrc) ? lrc.replace(/(?:\[00:(\d\d:\d\d.\d+\]))/gm, '[$1') : lrc
const PICTURE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const normalizedMimeType = (value?: string | null): string | undefined => {
  const mimeType = value?.split(';', 1)[0].trim().toLowerCase()
  return mimeType != null && PICTURE_MIME_TYPES.has(mimeType) ? mimeType : undefined
}

const detectPictureMimeType = (bytes: Uint8Array): string | undefined => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

const resolvePicture = (resolved?: Uint8Array, hintedMimeType?: string): { bytes: Buffer, mimeType: string } | undefined => {
  if (resolved == null) return undefined
  const bytes = Buffer.from(resolved)
  if (bytes.length === 0) throw new Error('Artwork response is empty')
  const mimeType = normalizedMimeType(hintedMimeType) ?? detectPictureMimeType(bytes)
  if (mimeType == null) throw new Error('Artwork image type is unsupported or unknown')
  return { bytes, mimeType }
}

export const applyDownloadMetadata = async(filePath: string, job: DownloadJobRecord, settings: TuneFlow.AppSetting, dependencies: MetadataDependencies = {}): Promise<MetadataWriteResult> => {
  const canEmbed = ['mp3', 'flac', 'ape', 'wav'].includes(job.extension)
  const wantsPicture = settings['download.isEmbedPic']
  const wantsLyrics = settings['download.isEmbedLyric'] || settings['download.isDownloadLrc']
  const picture = wantsPicture ? resolvePicture(dependencies.pictureBytes, dependencies.pictureMimeType) : undefined
  const lyrics = wantsLyrics ? dependencies.lyrics ?? null : null
  const warnings: string[] = []
  if (wantsPicture && picture == null) warnings.push('Artwork unavailable')
  if (wantsLyrics && lyrics == null) warnings.push('Lyrics unavailable')
  const embeddedLyrics = canEmbed && settings['download.isEmbedLyric'] && lyrics != null
    ? buildLyrics(lyrics, settings['download.isEmbedVerbatimLyric'], settings['download.isEmbedLyricT'], settings['download.isEmbedLyricR'])
    : null
  const meta: AudioMetadata = {
    title: job.musicInfo.name,
    artist: job.musicInfo.singer?.replaceAll('、', ';') ?? null,
    album: job.musicInfo.meta.albumName ?? null,
    picture: picture?.bytes,
    pictureMimeType: picture?.mimeType,
    lyrics: embeddedLyrics,
  }
  if (canEmbed) {
    await (dependencies.writeAudioMetadata ?? writeAudioMetadata)(filePath, meta)
  }
  if (settings['download.isDownloadLrc'] && lyrics?.lyric) {
    const lrc = buildLyrics({ ...lyrics, lyric: fixKgLyric(lyrics.lyric) }, settings['download.isDownloadVerbatimLyric'], settings['download.isDownloadTLrc'], settings['download.isDownloadRLrc'])
    const encoded = iconv.encode(lrc, settings['download.lrcFormat'] === 'gbk' ? 'gbk' : 'utf8', { addBOM: true })
    await writeFile(dependencies.lyricFilePath ?? filePath.slice(0, -path.extname(filePath).length) + '.lrc', encoded)
  }
  return { warnings }
}
