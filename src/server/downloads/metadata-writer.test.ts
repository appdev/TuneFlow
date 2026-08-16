import { afterEach, describe, expect, it, vi } from 'vitest'
import defaultSetting from '../../common/defaultSetting'
import { applyDownloadMetadata } from './metadata'
import type { DownloadJobRecord } from './types'

const settings: TuneFlow.AppSetting = {
  ...defaultSetting,
  'download.isEmbedPic': false,
  'download.isEmbedLyric': true,
  'download.isDownloadLrc': false,
  'download.isEmbedVerbatimLyric': false,
  'download.isEmbedLyricT': true,
  'download.isEmbedLyricR': false,
}

const job: DownloadJobRecord = {
  id: 'fixture-download',
  status: 'running',
  musicInfo: {
    id: 'fixture-track',
    name: 'Fixture track',
    singer: 'Fixture artist',
    source: 'kw',
    interval: '00:02',
    meta: {
      songId: 'fixture-track',
      albumName: 'Fixture album',
      qualitys: [],
      _qualitys: {},
    },
  },
  quality: 'flac',
  extension: 'flac',
  fileName: 'fixture.flac',
  finalRelativePath: 'audio/fixture.flac',
  partRelativePath: 'tmp/fixture.flac.part',
  downloaded: 0,
  total: 0,
  createdAt: 0,
  updatedAt: 0,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Service download metadata writer', () => {
  it('embeds timestamp-matched translated lyrics through the canonical helper', async() => {
    let writtenLyrics: string | null | undefined

    await applyDownloadMetadata('/library/fixture.flac', job, settings, {
      lyrics: {
        lyric: '[00:01.00]Original',
        tlyric: '[00:01.00]Translated\n[00:02.00]Unmatched',
      },
      writeAudioMetadata: async(_path, metadata) => { writtenLyrics = metadata.lyrics },
    })

    expect(writtenLyrics).toBe('[00:01.00]Original\n\n[00:01.00]Translated\n')
  })

  it('passes resolved artwork bytes and MIME to FLAC without refetching', async() => {
    const pictureBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    let written: Record<string, unknown> | undefined

    await applyDownloadMetadata('/library/fixture.flac', job, {
      ...settings,
      'download.isEmbedPic': true,
    }, {
      pictureBytes,
      pictureMimeType: 'image/png',
      lyrics: { lyric: '[00:01.00]Bundle lyric' },
      writeAudioMetadata: async(_path, metadata) => { written = metadata as unknown as Record<string, unknown> },
    })

    expect(written).toMatchObject({
      picture: pictureBytes,
      pictureMimeType: 'image/png',
      lyrics: '[00:01.00]Bundle lyric',
    })
  })

  it('does not refetch snapshot URLs and reports missing requested artwork', async() => {
    const fetchMock = vi.fn(async() => { throw new Error('metadata must not fetch') })
    vi.stubGlobal('fetch', fetchMock)
    let written: Record<string, unknown> | undefined

    const result = await applyDownloadMetadata('/library/fixture.flac', {
      ...job,
      musicInfo: { ...job.musicInfo, meta: { ...job.musicInfo.meta, picUrl: 'https://example.test/cover' } },
    }, {
      ...settings,
      'download.isEmbedPic': true,
      'download.isEmbedLyric': false,
    }, {
      writeAudioMetadata: async(_path, metadata) => { written = metadata as unknown as Record<string, unknown> },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(written).toMatchObject({ title: 'Fixture track', picture: undefined })
    expect(result.warnings).toEqual(['Artwork unavailable'])
  })

  it('keeps artwork and basic tags when requested lyrics are absent', async() => {
    const pictureBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const writer = vi.fn(async() => {})

    const result = await applyDownloadMetadata('/library/fixture.flac', job, {
      ...settings,
      'download.isEmbedPic': true,
    }, { pictureBytes, pictureMimeType: 'image/png', writeAudioMetadata: writer })

    expect(writer).toHaveBeenCalledWith('/library/fixture.flac', expect.objectContaining({
      title: 'Fixture track',
      picture: pictureBytes,
      lyrics: null,
    }))
    expect(result.warnings).toEqual(['Lyrics unavailable'])
  })

  it('writes basic tags even when enrichment embedding is disabled', async() => {
    const writer = vi.fn(async() => {})

    const result = await applyDownloadMetadata('/library/fixture.flac', job, {
      ...settings,
      'download.isEmbedLyric': false,
    }, { writeAudioMetadata: writer })

    expect(writer).toHaveBeenCalledWith('/library/fixture.flac', expect.objectContaining({
      title: 'Fixture track',
      artist: 'Fixture artist',
      album: 'Fixture album',
    }))
    expect(result.warnings).toEqual([])
  })

  it.each(['mp3', 'flac', 'ape', 'wav'] as const)('routes enabled %s metadata through the unified writer', async(extension) => {
    const writer = vi.fn(async() => {})

    await applyDownloadMetadata(`/library/fixture.${extension}`, { ...job, extension }, settings, {
      lyrics: { lyric: '[00:01.00]Unified lyric' },
      writeAudioMetadata: writer,
    })

    expect(writer).toHaveBeenCalledWith(`/library/fixture.${extension}`, expect.objectContaining({
      title: 'Fixture track',
      artist: 'Fixture artist',
      album: 'Fixture album',
      lyrics: '[00:01.00]Unified lyric',
    }))
  })
})
