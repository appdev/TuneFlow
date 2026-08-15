import { describe, expect, it, vi } from 'vitest'
import { createPlaybackSessionManager, type PlaybackSessionStart } from './playbackSession'

const track = { id: 'song-1', source: 'kw', name: 'Song' }
const session = (playbackId: string): PlaybackSessionStart => ({ playbackId })

describe('createPlaybackSessionManager', () => {
  it('starts once for duplicate playing events and reports an interruption', async() => {
    const start = vi.fn(async() => session('play-1'))
    const end = vi.fn(async() => {})
    const manager = createPlaybackSessionManager({ start, end })

    await manager.started(track)
    await manager.started(track)
    await manager.interrupted({ position: 12, duration: 100 })

    expect(start).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalledWith('play-1', {
      completed: false,
      lastPositionSeconds: 12,
      durationSeconds: 100,
    }, false)
  })

  it('reports natural completion and allows a repeat-one session', async() => {
    const start = vi.fn()
      .mockResolvedValueOnce(session('play-1'))
      .mockResolvedValueOnce(session('play-2'))
    const end = vi.fn(async() => {})
    const manager = createPlaybackSessionManager({ start, end })

    await manager.started(track)
    await manager.completed({ position: 100, duration: 100 })
    await manager.started(track)

    expect(end).toHaveBeenCalledWith('play-1', {
      completed: true,
      lastPositionSeconds: 100,
      durationSeconds: 100,
    }, false)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('finishes a pending start when the user switches before POST resolves', async() => {
    let resolveStart!: (value: PlaybackSessionStart) => void
    const start = vi.fn(async() => await new Promise<PlaybackSessionStart>(resolve => { resolveStart = resolve }))
    const end = vi.fn(async() => {})
    const manager = createPlaybackSessionManager({ start, end })

    const pending = manager.started(track)
    await manager.interrupted({ position: 2, duration: 100 })
    resolveStart(session('late-play'))
    await pending

    expect(end).toHaveBeenCalledWith('late-play', {
      completed: false,
      lastPositionSeconds: 2,
      durationSeconds: 100,
    }, false)
  })

  it('keeps playback behavior non-fatal when start or end reporting fails', async() => {
    const manager = createPlaybackSessionManager({
      start: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(session('play-2')),
      end: vi.fn().mockRejectedValue(new Error('offline')),
      log: () => {},
    })

    await expect(manager.started(track)).resolves.toBeUndefined()
    await expect(manager.started(track)).resolves.toBeUndefined()
    await expect(manager.completed({ position: 5, duration: 10 })).resolves.toBeUndefined()
  })

  it('uses keepalive when disposed with an active session', async() => {
    const end = vi.fn(async() => {})
    const manager = createPlaybackSessionManager({ start: async() => session('play-1'), end })
    await manager.started(track)

    manager.dispose({ position: 8, duration: 30 })
    await vi.waitFor(() => {
      expect(end).toHaveBeenCalledWith('play-1', {
        completed: false,
        lastPositionSeconds: 8,
        durationSeconds: 30,
      }, true)
    })
  })
})
