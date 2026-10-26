import { ServiceClient } from './client'
import type { ServiceProvenance } from './tracks'

interface Session {
  key: string
  client: ServiceClient
  started: Promise<{ playbackId: string }>
  position: number
  duration: number
}

const platforms: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' }
/** Called only by native playback events, never by search, selection or resolve. */
export class ServicePlaybackHistory {
  private session: Session | null = null
  constructor(private readonly onError: () => void = () => {}, private readonly makeClient = (endpoint: string) => new ServiceClient(endpoint)) {}

  playing(key: string, service: ServiceProvenance) {
    if (this.session?.key === key) return
    this.end(false)
    const client = this.makeClient(service.endpoint)
    const started = client.request<{ playbackId: string }>('/api/v1/playback/history', 'POST', {
      track: service.track,
      platform: platforms[process.platform] ?? 'other',
      ...(service.recommendationItemId ? { recommendationItemId: service.recommendationItemId } : {}),
    })
    // Observe immediately, including sessions that have not ended yet.
    void started.catch(this.onError)
    this.session = { key, client, started, position: 0, duration: 0 }
  }

  progress(position: number, duration: number, key?: string) {
    if (!this.session) return
    if (key !== undefined && key !== this.session.key) return
    // Q changes the selected track and clears progress before musicToggled.
    // Preserve the previous session, including replaying the same track ID.
    if (position === 0 && duration === 0 && this.session.duration > 0) return
    this.session.position = Number.isFinite(position) ? Math.max(0, position) : 0
    this.session.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0
  }

  end(completed: boolean) {
    const session = this.session
    if (!session) return
    this.session = null
    // A quick next/stop may arrive before POST completes. Close the original
    // playback ID exactly once, without attaching it to the next song.
    void session.started.then(async({ playbackId }) => {
      await session.client.request(`/api/v1/playback/history/${encodeURIComponent(playbackId)}`, 'PATCH', {
        completed, lastPositionSeconds: session.position, durationSeconds: session.duration,
      })
    }).catch(this.onError)
  }
}
