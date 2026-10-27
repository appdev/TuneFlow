import { expect, it, vi } from 'vitest'
import { createAccountReader } from '../../../../../packages/platform-accounts/src/reader'

it.each([2, 3, 4])('checks the full ID list when NetEase summary count is %i', async trackCount => {
  const ids = ['101', '102', '103']
  const fetchOfficial = vi.fn(async(input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/account/get')) return Response.json({ code: 200, profile: { userId: 10001 } })
    if (path.endsWith('/playlist/detail')) return Response.json({ code: 200, playlist: { trackCount, trackIds: ids.map(id => ({ id })) } })
    if (path.endsWith('/song/detail')) return Response.json({ code: 200, songs: ids.map(id => ({ id })), privileges: ids.map(id => ({ id })) })
    throw new Error('Unexpected official request')
  })
  const reader = createAccountReader({
    session: async() => ({ fetch: fetchOfficial, cookies: { get: async() => [{ name: 'MUSIC_U', value: 'synthetic-session' }] } }),
    credential: () => '',
    kugou: { session: () => null, playlists: async() => [], daily: async() => [], detail: async() => [] },
  })
  const result = await reader.getMusicAccountPlaylistDetail('wy', '12345')
  expect(result.status).toBe(trackCount > ids.length ? 'playlist_incomplete' : 'available')
  expect(result.ids).toEqual(trackCount > ids.length ? [] : ids)
  expect(fetchOfficial.mock.calls.some(([input]) => String(input).endsWith('/song/detail'))).toBe(trackCount <= ids.length)
})
