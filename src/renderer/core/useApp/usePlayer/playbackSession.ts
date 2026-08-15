export interface PlaybackTrack extends Record<string, unknown> {
  id: string
  source: string
}

export interface PlaybackSessionStart {
  playbackId: string
}

export interface PlaybackProgress {
  position: number
  duration: number
}

interface PlaybackTerminal {
  completed: boolean
  lastPositionSeconds: number
  durationSeconds: number
}

interface PlaybackSessionDependencies {
  start: (track: PlaybackTrack) => Promise<PlaybackSessionStart>
  end: (playbackId: string, terminal: PlaybackTerminal, keepalive: boolean) => Promise<void>
  log?: (error: unknown) => void
}

interface ActivePlayback {
  playbackId: string | null
  terminal: PlaybackTerminal | null
}

export interface PlaybackSessionManager {
  started: (track: PlaybackTrack) => Promise<void>
  completed: (progress: PlaybackProgress) => Promise<void>
  interrupted: (progress: PlaybackProgress) => Promise<void>
  dispose: (progress: PlaybackProgress) => void
}

const terminal = (completed: boolean, progress: PlaybackProgress): PlaybackTerminal => ({
  completed,
  lastPositionSeconds: Math.max(0, Number.isFinite(progress.position) ? progress.position : 0),
  durationSeconds: Math.max(0, Number.isFinite(progress.duration) ? progress.duration : 0),
})

export const createPlaybackSessionManager = (dependencies: PlaybackSessionDependencies): PlaybackSessionManager => {
  const log = dependencies.log ?? (error => { console.warn('Unable to report playback session', error) })
  let active: ActivePlayback | null = null

  const reportEnd = async(entry: ActivePlayback, keepalive: boolean): Promise<void> => {
    if (entry.playbackId == null || entry.terminal == null) return
    try {
      await dependencies.end(entry.playbackId, entry.terminal, keepalive)
    } catch (error) {
      log(error)
    }
  }

  const finish = async(value: PlaybackTerminal, keepalive = false): Promise<void> => {
    const entry = active
    if (entry == null) return
    active = null
    entry.terminal = value
    await reportEnd(entry, keepalive)
  }

  return {
    async started(track) {
      if (active != null) return
      const entry: ActivePlayback = { playbackId: null, terminal: null }
      active = entry
      try {
        const created = await dependencies.start(track)
        entry.playbackId = created.playbackId
        if (entry.terminal != null) await reportEnd(entry, false)
      } catch (error) {
        if (active === entry) active = null
        log(error)
      }
    },
    async completed(progress) {
      await finish(terminal(true, progress))
    },
    async interrupted(progress) {
      await finish(terminal(false, progress))
    },
    dispose(progress) {
      void finish(terminal(false, progress), true)
    },
  }
}

const responseError = async(response: Response): Promise<Error> => {
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') return new Error(body.error.message)
  } catch {}
  return new Error(`Playback history request failed (${response.status})`)
}

export const createServicePlaybackSessionManager = (): PlaybackSessionManager => createPlaybackSessionManager({
  start: async track => {
    const response = await fetch('/api/v1/playback/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track, platform: 'web' }),
    })
    if (!response.ok) throw await responseError(response)
    const body = await response.json() as { data?: { playbackId?: unknown } }
    if (typeof body.data?.playbackId !== 'string' || body.data.playbackId.length === 0) {
      throw new Error('Playback history response contains no playbackId')
    }
    return { playbackId: body.data.playbackId }
  },
  end: async(playbackId, value, keepalive) => {
    const response = await fetch(`/api/v1/playback/history/${encodeURIComponent(playbackId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
      keepalive,
    })
    if (!response.ok) throw await responseError(response)
  },
})
