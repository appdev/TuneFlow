import { describe, expect, it } from 'vitest'
import defaultSetting from '../../common/defaultSetting'
import { applyDownloadMetadata } from './metadata'
import type { DownloadJobRecord } from './types'

const settings: LX.AppSetting = {
  ...defaultSetting,
  'download.isEmbedPic': false,
  'download.isEmbedLyric': true,
  'download.isDownloadLrc': false,
  'download.isEmbedLyricLx': false,
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

describe('Service download metadata writer', () => {
  it('embeds timestamp-matched translated lyrics through the canonical helper', async() => {
    let writtenLyrics: string | null | undefined

    await applyDownloadMetadata('/library/fixture.flac', job, settings, {
      getLyrics: async() => ({
        lyric: '[00:01.00]Original',
        tlyric: '[00:01.00]Translated\n[00:02.00]Unmatched',
      }),
      writeFlacMetadata: async(_path, metadata) => { writtenLyrics = metadata.lyrics },
    })

    expect(writtenLyrics).toBe('[00:01.00]Original\n\n[00:01.00]Translated\n')
  })
})
