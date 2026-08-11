import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import NodeID3 from 'node-id3'
import { setMeta } from '../../common/utils/musicMeta'
import { buildLyrics } from '@common/utils/musicMeta/buildLyrics'
import type { DownloadJobRecord } from './types'

export interface MetadataDependencies {
  getPicture?: (musicInfo: LX.Music.MusicInfoOnline) => Promise<string | null>
  getLyrics?: (musicInfo: LX.Music.MusicInfoOnline) => Promise<LX.Music.LyricInfo | null>
  writeFlacMetadata?: (filePath: string, meta: Parameters<typeof setMeta>[1]) => Promise<void>
}

const fixKgLyric = (lrc: string): string => /\[00:\d\d:\d\d.\d+\]/.test(lrc) ? lrc.replace(/(?:\[00:(\d\d:\d\d.\d+\]))/gm, '[$1') : lrc

export const applyDownloadMetadata = async(filePath: string, job: DownloadJobRecord, settings: LX.AppSetting, dependencies: MetadataDependencies = {}): Promise<void> => {
  const canEmbed = job.extension === 'mp3' || job.extension === 'flac'
  const [picture, lyrics] = await Promise.all([
    settings['download.isEmbedPic'] ? dependencies.getPicture?.(job.musicInfo) ?? Promise.resolve(job.musicInfo.meta.picUrl ?? null) : Promise.resolve(null),
    settings['download.isEmbedLyric'] || settings['download.isDownloadLrc'] ? dependencies.getLyrics?.(job.musicInfo) ?? Promise.resolve(null) : Promise.resolve(null),
  ])
  const embeddedLyrics = canEmbed && settings['download.isEmbedLyric'] && lyrics != null
    ? buildLyrics(lyrics, settings['download.isEmbedLyricLx'], settings['download.isEmbedLyricT'], settings['download.isEmbedLyricR'])
    : null
  const meta = {
    title: job.musicInfo.name,
    artist: job.musicInfo.singer?.replaceAll('、', ';') ?? null,
    album: job.musicInfo.meta.albumName ?? null,
    APIC: picture,
    lyrics: embeddedLyrics,
  }
  if (canEmbed && (settings['download.isEmbedPic'] || settings['download.isEmbedLyric']) && job.extension === 'mp3') {
    const tags: NodeID3.Tags = { title: meta.title, artist: meta.artist ?? undefined, album: meta.album ?? undefined }
    if (meta.APIC != null) {
      tags.image = /^https?:/.test(meta.APIC)
        ? Buffer.from(await (await fetch(meta.APIC)).arrayBuffer())
        : meta.APIC
    }
    if (meta.lyrics) tags.unsynchronisedLyrics = { language: 'zho', text: meta.lyrics }
    if (!NodeID3.write(tags, filePath)) throw new Error('Unable to write MP3 metadata')
  } else if (canEmbed && (settings['download.isEmbedPic'] || settings['download.isEmbedLyric'])) {
    await (dependencies.writeFlacMetadata ?? (async(target, value) => { await setMeta(target, value) }))(filePath, meta)
  }
  if (settings['download.isDownloadLrc'] && lyrics?.lyric) {
    const lrc = buildLyrics({ ...lyrics, lyric: fixKgLyric(lyrics.lyric) }, settings['download.isDownloadLxLrc'], settings['download.isDownloadTLrc'], settings['download.isDownloadRLrc'])
    const encoded = iconv.encode(lrc, settings['download.lrcFormat'] === 'gbk' ? 'gbk' : 'utf8', { addBOM: true })
    await writeFile(filePath.slice(0, -path.extname(filePath).length) + '.lrc', encoded)
  }
}
