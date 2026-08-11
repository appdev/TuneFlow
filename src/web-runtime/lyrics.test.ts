import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fetchServiceLyric, fetchServicePicture } from './lyrics'

describe('Web lyric client', () => {
  it('requests lyrics from the same-origin Service endpoint', async() => {
    const fetchImpl = vi.fn(async() => new Response(JSON.stringify({
      data: { lyric: '[00:01.000]line', tlyric: '', rlyric: '', lxlyric: '' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const musicInfo = { id: 'tx_1', source: 'tx', name: 'Song', singer: 'Artist', meta: { songId: 1 } }

    await expect(fetchServiceLyric(musicInfo, fetchImpl)).resolves.toMatchObject({ lyric: '[00:01.000]line' })
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/catalog/tracks/lyrics', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source: 'tx', musicInfo }),
    }))
  })

  it('preserves the Service error message', async() => {
    const fetchImpl = vi.fn(async() => new Response(JSON.stringify({ error: { message: 'Lyric source request failed' } }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(fetchServiceLyric({ source: 'tx' }, fetchImpl)).rejects.toThrow('Lyric source request failed')
  })

  it('requests a track picture through the catalog contract', async() => {
    const fetchImpl = vi.fn(async() => new Response(JSON.stringify({ data: { url: 'https://img.test/cover.jpg' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(fetchServicePicture({ source: 'kw', id: '1' }, fetchImpl)).resolves.toBe('https://img.test/cover.jpg')
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/catalog/tracks/picture', expect.objectContaining({ method: 'POST' }))
  })

  it('routes local-library lyric and picture fallbacks through the Service', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/renderer/core/music/local.ts'), 'utf8')
    expect(source).toContain('fetchServicePicture(target)')
    expect(source).toContain('fetchServiceLyric(target)')
    expect(source).not.toMatch(/getOnlineOtherSource(?:Lyric|Pic)/)
  })
})
