import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import { buildLyrics } from '@common/utils/musicMeta/buildLyrics'
import type { DownloadJobRecord } from './types'
import { writeAudioMetadata } from './taglibMetadata'
import type { AudioMetadata } from './taglibMetadata'

export interface MetadataDependencies {
  getPicture?: (musicInfo: TuneFlow.Music.MusicInfoOnline) => Promise<string | null>
  getLyrics?: (musicInfo: TuneFlow.Music.MusicInfoOnline) => Promise<TuneFlow.Music.LyricInfo | null>
  pictureBytes?: Uint8Array
  pictureMimeType?: string
  lyrics?: TuneFlow.Music.LyricInfo
  writeAudioMetadata?: (filePath: string, meta: AudioMetadata) => Promise<void>
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

const resolvePicture = async(source: string | Uint8Array | null | PromiseLike<string | null>, hintedMimeType?: string): Promise<{ bytes: Buffer, mimeType: string } | undefined> => {
  const resolved = await source
  if (resolved == null) return undefined
  let bytes: Buffer
  let responseMimeType: string | undefined
  if (typeof resolved === 'string') {
    let url: URL
    try { url = new URL(resolved) } catch { throw new Error('Artwork URL is invalid') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported artwork URL protocol: ${url.protocol}`)
    const response = await fetch(resolved)
    if (!response.ok) throw new Error(`Artwork request returned HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    responseMimeType = response.headers.get('content-type') ?? undefined
  } else {
    bytes = Buffer.from(resolved)
  }
  if (bytes.length === 0) throw new Error('Artwork response is empty')
  const mimeType = normalizedMimeType(hintedMimeType) ?? normalizedMimeType(responseMimeType) ?? detectPictureMimeType(bytes)
  if (mimeType == null) throw new Error('Artwork image type is unsupported or unknown')
  return { bytes, mimeType }
}

export const applyDownloadMetadata = async(filePath: string, job: DownloadJobRecord, settings: TuneFlow.AppSetting, dependencies: MetadataDependencies = {}): Promise<void> => {
  const canEmbed = ['mp3', 'flac', 'ape', 'wav'].includes(job.extension)
  const [picture, lyrics] = await Promise.all([
    settings['download.isEmbedPic']
      ? resolvePicture(
        dependencies.pictureBytes ?? dependencies.getPicture?.(job.musicInfo) ?? Promise.resolve(job.musicInfo.meta.picUrl ?? null),
        dependencies.pictureMimeType,
      )
      : Promise.resolve(undefined),
    settings['download.isEmbedLyric'] || settings['download.isDownloadLrc']
      ? dependencies.lyrics == null
        ? dependencies.getLyrics?.(job.musicInfo) ?? Promise.resolve(null)
        : Promise.resolve(dependencies.lyrics)
      : Promise.resolve(null),
  ])
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
  if (canEmbed && (settings['download.isEmbedPic'] || settings['download.isEmbedLyric'])) {
    await (dependencies.writeAudioMetadata ?? writeAudioMetadata)(filePath, meta)
  }
  if (settings['download.isDownloadLrc'] && lyrics?.lyric) {
    const lrc = buildLyrics({ ...lyrics, lyric: fixKgLyric(lyrics.lyric) }, settings['download.isDownloadVerbatimLyric'], settings['download.isDownloadTLrc'], settings['download.isDownloadRLrc'])
    const encoded = iconv.encode(lrc, settings['download.lrcFormat'] === 'gbk' ? 'gbk' : 'utf8', { addBOM: true })
    await writeFile(filePath.slice(0, -path.extname(filePath).length) + '.lrc', encoded)
  }
}
