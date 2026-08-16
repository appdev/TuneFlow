import { describe, expect, it } from 'vitest'
import { canonicalPictureUrl, normalizeMusicInfo, toSourceMusicInfo } from './musicInfo'
import { toNewMusicInfo } from '../../common/utils/tools'

const base = {
  id: 'legacy-id',
  name: '大梦',
  singer: '瓦依那、任素汐',
  source: 'tx',
}

describe('music info compatibility boundary', () => {
  it.each([
    [{ meta: { songId: '1', picUrl: 'https://canonical.test/cover.jpg' }, img: 'https://img.test/cover.jpg', pic: 'https://pic.test/cover.jpg' }, 'https://canonical.test/cover.jpg'],
    [{ meta: { songId: '1', picUrl: ' ' }, img: 'https://img.test/cover.jpg', pic: 'https://pic.test/cover.jpg' }, 'https://img.test/cover.jpg'],
    [{ meta: { songId: '1' }, img: 'file:///tmp/private.jpg', pic: 'https://pic.test/cover.jpg' }, 'https://pic.test/cover.jpg'],
    [{ meta: { songId: '1' }, img: 'data:image/png;base64,AA==' }, undefined],
  ])('promotes the first valid artwork candidate', (input, expected) => {
    const normalized = normalizeMusicInfo({ ...base, ...input }) as TuneFlow.Music.MusicInfoOnline

    expect(normalized.meta.songId).toBe('1')
    expect(normalized.meta.picUrl).toBe(expected)
    expect(canonicalPictureUrl({ ...base, ...input })).toBe(expected)
  })

  it('canonicalizes legacy Web query fields without dropping provider metadata', () => {
    const input = {
      ...base,
      songmid: 'song-mid',
      albumName: '专辑',
      albumId: 'album-id',
      img: 'https://img.test/cover.jpg',
      types: [{ type: '128k', size: '1' }],
      _types: { high: { size: '2' } },
      strMediaMid: 'media-mid',
      songId: 'qq-id',
      albumMid: 'album-mid',
      providerOnly: { retained: true },
    }

    const normalized = normalizeMusicInfo(input) as TuneFlow.Music.MusicInfoOnline

    expect((normalized as unknown as Record<string, unknown>).providerOnly).toEqual({ retained: true })
    expect(normalized.meta).toMatchObject({
      songId: 'song-mid',
      albumName: '专辑',
      albumId: 'album-id',
      picUrl: 'https://img.test/cover.jpg',
      qualitys: input.types,
      _qualitys: input._types,
      strMediaMid: 'media-mid',
      id: 'qq-id',
      albumMid: 'album-mid',
    })
    expect(toSourceMusicInfo(input)).toMatchObject({
      songmid: 'song-mid',
      img: 'https://img.test/cover.jpg',
      strMediaMid: 'media-mid',
      songId: 'qq-id',
      albumMid: 'album-mid',
    })
  })

  it.each([
    ['kg', { hash: 'kg-hash' }, { hash: 'kg-hash' }],
    ['mg', { copyrightId: 'mg-id', lrcUrl: 'lrc', mrcUrl: 'mrc', trcUrl: 'trc' }, { copyrightId: 'mg-id', lrcUrl: 'lrc', mrcUrl: 'mrc', trcUrl: 'trc' }],
  ])('preserves %s provider query fields', (source, fields, expected) => {
    const normalized = normalizeMusicInfo({ ...base, source, songmid: 'song-id', ...fields }) as TuneFlow.Music.MusicInfoOnline

    expect(normalized.meta).toMatchObject(expected)
  })

  it('matches bundled Web core canonical fields for the same catalog result', () => {
    const catalogResult = {
      ...base,
      songmid: 'song-mid',
      albumName: '专辑',
      albumId: 'album-id',
      img: 'https://img.test/cover.jpg',
      types: [],
      _types: {},
      strMediaMid: 'media-mid',
      songId: 'qq-id',
      albumMid: 'album-mid',
    }
    const web = toNewMusicInfo(catalogResult)
    const service = normalizeMusicInfo(catalogResult) as TuneFlow.Music.MusicInfoOnline
    const core = (value: TuneFlow.Music.MusicInfoOnline) => {
      const meta = value.meta as unknown as Record<string, unknown>
      return {
        name: value.name,
        singer: value.singer,
        source: value.source,
        meta: {
          songId: meta.songId,
          albumName: meta.albumName,
          albumId: meta.albumId,
          picUrl: meta.picUrl,
          strMediaMid: meta.strMediaMid,
          id: meta.id,
          albumMid: meta.albumMid,
        },
      }
    }

    expect(core(service)).toEqual(core(web as TuneFlow.Music.MusicInfoOnline))
  })
})
