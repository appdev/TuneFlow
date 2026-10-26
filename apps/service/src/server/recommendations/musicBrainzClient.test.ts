import { describe, expect, it, vi } from 'vitest'
import { MusicBrainzClient, type MusicBrainzClientError } from './musicBrainzClient'

const json = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

describe('MusicBrainzClient', () => {
  it('rejects cross-origin redirects', async() => {
    const client = new MusicBrainzClient('https://music.example/ws/2/', {
      fetch: vi.fn(async() => new Response(null, { status: 302, headers: { location: 'https://other.example/ws/2/' } })),
    })
    await expect(client.getJson('recording/test?fmt=json')).rejects.toMatchObject<Partial<MusicBrainzClientError>>({ code: 'cross_origin_redirect' })
  })

  it('rejects a body larger than the configured limit before parsing it', async() => {
    const client = new MusicBrainzClient('https://music.example/ws/2/', {
      maxResponseBytes: 4,
      fetch: vi.fn(async() => json({ value: 'too large' })),
    })
    await expect(client.getJson('recording/test?fmt=json')).rejects.toMatchObject<Partial<MusicBrainzClientError>>({ code: 'response_too_large' })
  })

  it('serializes requests to the official host with a safe interval', async() => {
    let now = 1_000
    const waits: number[] = []
    const client = new MusicBrainzClient('https://musicbrainz.org/ws/2/', {
      now: () => now,
      sleep: async milliseconds => { waits.push(milliseconds); now += milliseconds },
      fetch: vi.fn(async() => json({ recordings: [] })),
    })
    await client.getJson('recording?fmt=json')
    await client.getJson('recording?fmt=json')
    expect(waits).toEqual([1_100])
  })

  it('queues concurrent official requests instead of releasing them together', async() => {
    let now = 1_000
    const waits: number[] = []
    const fetch = vi.fn(async() => json({ recordings: [] }))
    const client = new MusicBrainzClient('https://musicbrainz.org/ws/2/', {
      now: () => now,
      sleep: async milliseconds => { waits.push(milliseconds); now += milliseconds },
      fetch,
    })

    await Promise.all([
      client.getJson('recording?query=one&fmt=json'),
      client.getJson('recording?query=two&fmt=json'),
      client.getJson('recording?query=three&fmt=json'),
    ])

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([1_100, 1_100])
  })

  it('retries temporary upstream failures with backoff', async() => {
    let now = 1_000
    const waits: number[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json({ recordings: [] }))
    const client = new MusicBrainzClient('https://musicbrainz.org/ws/2/', {
      now: () => now,
      sleep: async milliseconds => { waits.push(milliseconds); now += milliseconds },
      fetch,
    })

    await expect(client.getJson('recording?fmt=json')).resolves.toEqual({ recordings: [] })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([2_000, 5_000])
  })

  it('honors Retry-After when it exceeds the configured backoff', async() => {
    let now = 1_000
    const waits: number[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(json({ recordings: [] }))
    const client = new MusicBrainzClient('https://musicbrainz.org/ws/2/', {
      now: () => now,
      sleep: async milliseconds => { waits.push(milliseconds); now += milliseconds },
      fetch,
      retryDelaysMs: [100],
    })

    await expect(client.getJson('recording?fmt=json')).resolves.toEqual({ recordings: [] })
    expect(waits).toEqual([3_000])
  })
})
