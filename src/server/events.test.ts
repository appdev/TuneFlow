import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerEventRoutes, ServiceEvents } from './routes/events'

describe('Service SSE event broker', () => {
  it('formats named events and releases disconnected clients', () => {
    const events = new ServiceEvents()
    const write = vi.fn<(chunk: string) => void>()
    const end = vi.fn<() => void>()
    const unsubscribe = events.subscribe({ write, end })

    events.publish('settings.updated', { 'player.volume': 0.6 })
    expect(write).toHaveBeenCalledWith('event: settings.updated\ndata: {"type":"settings.updated","data":{"player.volume":0.6},"sequence":1}\n\n')
    expect(events.clientCount).toBe(1)

    unsubscribe()
    events.publish('settings.updated', { 'player.volume': 0.4 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(events.clientCount).toBe(0)

    events.close()
    expect(end).not.toHaveBeenCalled()
  })

  it('ends live responses and drops all references on close', () => {
    const events = new ServiceEvents()
    const first = { write: vi.fn<(chunk: string) => void>(), end: vi.fn<() => void>() }
    const second = { write: vi.fn<(chunk: string) => void>(), end: vi.fn<() => void>() }
    events.subscribe(first)
    events.subscribe(second)

    events.close()

    expect(first.end).toHaveBeenCalledOnce()
    expect(second.end).toHaveBeenCalledOnce()
    expect(events.clientCount).toBe(0)
  })

  it('does not broadcast legacy local file paths to SSE clients', () => {
    const events = new ServiceEvents()
    const write = vi.fn<(chunk: string) => void>()
    events.subscribe({ write, end: () => {} })

    events.publish('playlist.tracks.added', { musicInfos: [{ id: '/private/music.mp3', source: 'local', meta: { songId: '/private/music.mp3', filePath: '/private/music.mp3' } }] })

    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).not.toContain('/private/music.mp3')
    expect(write.mock.calls[0][0]).not.toContain('filePath')
  })

  it('serves an SSE stream and releases the response when the browser closes it', async() => {
    const app = Fastify()
    const events = new ServiceEvents()
    registerEventRoutes(app, events)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    try {
      const response = await fetch(`${origin}/api/v1/events`)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body!.getReader()
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toBe(': connected\n\n')
      expect(events.clientCount).toBe(1)

      await reader.cancel()
      await vi.waitFor(() => {
        expect(events.clientCount).toBe(0)
      })
    } finally {
      await app.close()
    }
  })
})
