import { describe, expect, it } from 'vitest'
import { sanitizePlaybackTrack } from './historyTrack'

describe('sanitizePlaybackTrack', () => {
  it('preserves stable metadata while removing private transport fields', () => {
    expect(sanitizePlaybackTrack({
      id: 'song-1',
      source: 'kw',
      name: 'Song',
      singer: 'Artist',
      pic: 'https://img.example/cover.jpg',
      meta: {
        albumName: 'Album',
        picUrl: 'https://img.example/meta-cover.jpg',
        filePath: '/private/music.mp3',
        url: 'https://provider.example/temporary-audio',
        headers: { authorization: 'secret' },
        token: 'secret',
      },
    })).toEqual({
      id: 'song-1',
      source: 'kw',
      name: 'Song',
      singer: 'Artist',
      pic: 'https://img.example/cover.jpg',
      meta: {
        albumName: 'Album',
        picUrl: 'https://img.example/meta-cover.jpg',
      },
    })
  })

  it('keeps only safe same-origin library stream locators', () => {
    const id = 'a'.repeat(64)
    expect(sanitizePlaybackTrack({ id: 'online', source: 'kw', streamUrl: `/api/v1/library/tracks/${id}/stream` }).streamUrl)
      .toBe(`/api/v1/library/tracks/${id}/stream`)
    expect(sanitizePlaybackTrack({ id: 'online', source: 'kw', streamUrl: 'https://private.example/audio' })).not.toHaveProperty('streamUrl')
  })
})
