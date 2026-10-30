/** TuneFlow Service transport. This module has no native dependencies. */
export interface TrackDto {
  id: string
  name?: string
  singer?: string
  source?: string
  interval?: string | null
  songmid?: string
  albumName?: string
  img?: string | null
  meta?: Record<string, any>
  [key: string]: unknown
}

export interface CollectionDto { id: string, name: string, source: string, kind?: 'playlist' | 'album', author?: string, img?: string | null, description?: string, playCount?: string, total?: number }
export interface Page<T> { list: T[], total: number | null, page: number, limit: number, hasMore?: boolean }
export interface SourceDto { id: string, name: string, version: string, enabled: boolean, priority: number | null, sources?: Record<string, unknown> }
export interface DownloadDto { id: string, status: 'waiting' | 'running' | 'paused' | 'error' | 'completed', musicInfo: TrackDto, quality: string, progress: number, error?: string }
export interface LibraryDto extends TrackDto { musicInfo: TrackDto, streamUrl: string, pictureUrl?: string, lyricsUrl?: string }
export interface ResolvedDto { url: string, quality: string, expiresAt: number, resources?: { pictureUrl?: string, lyrics?: LyricsDto } }
export interface LyricsDto { lyric: string, tlyric?: string | null, rlyric?: string | null, verbatimLyric?: string | null }
export interface ProviderDto { id: string, name: string, searchKinds: string[], leaderboards: boolean, playlistDiscovery?: { browse: boolean, detail: boolean } }

export class ServiceError extends Error {
  constructor(public code: string, public status = 0) { super(({
    DOWNLOAD_TASK_ACTIVE: '这首歌曲已有未完成的下载，请先完成或移除旧任务，再选择新的音质。',
    ACCOUNT_CHANGED: '账号已发生变化，请刷新后重试。',
    PLATFORM_LOGIN_REQUIRED: '平台授权已过期，请重新登录。',
    ACCOUNT_LOGIN_EXPIRED: '二维码已过期或已取消，请重新获取。',
    ACCOUNT_LOGIN_UNAVAILABLE: '官方登录暂不可用，请重试或在应用中完成授权。',
    ACCOUNT_VERIFICATION_REQUIRED: '网易云要求安全验证。请在桌面或 Android 客户端通过官方页面授权完成登录，再共享账号并刷新。',
    ACCOUNT_RATE_LIMIT: '操作过于频繁，请稍后重试。',
  } as Record<string, string>)[code] ?? `请求失败（${code}）`) }
}

// Shared address contract with the Android Service client.
export const normalizeEndpoint = (input: string): string => {
  const value = input.trim().replace(/\/+$/, '')
  const match = /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?((?:\/[a-zA-Z0-9._~%-]+)*)$/.exec(value)
  if (!match || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))) throw new ServiceError('INVALID_SERVER_ADDRESS')
  try {
    if (match[4].split('/').some(part => /[\\/@?#]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part)))) throw new Error('path')
  } catch { throw new ServiceError('INVALID_SERVER_ADDRESS') }
  return value
}

export class ServiceClient {
  readonly endpoint: string
  private readonly accountClientId = `client_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
  constructor(endpoint: string, private readonly transport: typeof fetch = fetch) { this.endpoint = normalizeEndpoint(endpoint) }

  resourceUrl(path: string): string {
    // Service media must remain on the selected origin; never accept provider URLs.
    if (!/^\/api\/v1\/(streams\/|playback\/resources\/|library\/tracks\/)/.test(path) || /[\\?#]/.test(path) || path.split('/').some(part => ['.', '..'].includes(part)) || /%2[ef]|%5c/i.test(path)) throw new ServiceError('INVALID_RESOURCE_URL')
    return this.endpoint + path
  }

  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!path.startsWith('/api/v1/')) throw new ServiceError('INVALID_API_PATH')
    const controller = new AbortController()
    const abort = () => { controller.abort() }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort)
    const timeout = setTimeout(abort, path.includes('/resolve') ? 100_000 : 25_000)
    try {
      const protectedAccount = /^\/api\/v1\/(?:accounts|access)(?:\/|\?|$)/.test(path)
      // Window.fetch rejects a ServiceClient receiver in Chromium/Electron.
      const transport = this.transport
      const response = await transport(this.endpoint + path, {
        method,
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(protectedAccount ? { 'X-TuneFlow-Client-Id': this.accountClientId } : {}) },
        ...(protectedAccount ? { redirect: 'error' as const, cache: 'no-store' as const } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.status === 204) return undefined as T
      const value = await response.json().catch(() => { throw new ServiceError(response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`, response.status) }) as { data?: T, error?: { code?: string } } | null
      if (controller.signal.aborted) throw new ServiceError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT')
      if (!response.ok) throw new ServiceError(/^[A-Z0-9_]+$/.test(value?.error?.code ?? '') ? value!.error!.code! : `HTTP_${response.status}`, response.status)
      if (!value || !Object.prototype.hasOwnProperty.call(value, 'data')) throw new ServiceError('INVALID_RESPONSE')
      return value.data as T
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ServiceError(controller.signal.aborted ? (signal?.aborted ? 'CANCELLED' : 'TIMEOUT') : 'NETWORK_ERROR')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async connect(signal?: AbortSignal) {
    const health = await this.request<{ status: string }>('/api/v1/health', 'GET', undefined, signal)
    if (health.status !== 'ok') throw new ServiceError('UNHEALTHY_SERVER')
    const capabilities = await this.request<{ sources: ProviderDto[] }>('/api/v1/catalog/capabilities', 'GET', undefined, signal)
    if (!Array.isArray(capabilities.sources)) throw new ServiceError('INVALID_CAPABILITIES')
    return capabilities.sources.filter(item => ['kw', 'kg', 'tx', 'wy', 'mg'].includes(item.id))
  }

  async search(source: string, text: string, page = 1, kind: 'tracks' | 'playlists' | 'albums' = 'tracks', signal?: AbortSignal) {
    return this.request<Page<TrackDto & CollectionDto>>(`/api/v1/catalog/${kind}/search`, 'POST', { source, text, page, pageSize: 30 }, signal)
  }

  async resolve(track: TrackDto, quality: string, recommendationItemId?: string, signal?: AbortSignal) {
    return this.request<ResolvedDto>('/api/v1/playback/tracks/resolve', 'POST', { source: track.source, info: track, quality, preferLocal: true, ...(recommendationItemId ? { recommendationItemId } : {}) }, signal)
  }

  async lyrics(track: TrackDto) { return this.request<LyricsDto>('/api/v1/catalog/tracks/lyrics', 'POST', { source: track.source, musicInfo: track }) }
  async picture(track: TrackDto) { return this.request<{ url: string }>('/api/v1/catalog/tracks/picture', 'POST', { source: track.source, musicInfo: track }) }
  async playlists() {
    const lists = await this.request<CollectionDto[]>('/api/v1/playlists?includeBuiltIn=true')
    return lists.map(item => ({ ...item, name: item.name === 'list__name_default' ? '默认列表' : item.name === 'list__name_love' ? '我喜欢' : item.name }))
  }

  async playlist(id: string) {
    const item = await this.request<CollectionDto & { tracks: TrackDto[] }>(`/api/v1/playlists/${encodeURIComponent(id)}`)
    return { ...item, name: item.name === 'list__name_default' ? '默认列表' : item.name === 'list__name_love' ? '我喜欢' : item.name }
  }

  async createPlaylist(name: string, id: string) { return this.request('/api/v1/playlists', 'POST', { position: 0, playlists: [{ id, name }] }) }
  async addTracks(id: string, tracks: TrackDto[]) { return this.request(`/api/v1/playlists/${encodeURIComponent(id)}/tracks`, 'POST', { tracks, position: 'bottom' }) }
  async removeTracks(id: string, trackIds: string[]) { return this.request(`/api/v1/playlists/${encodeURIComponent(id)}/tracks/remove`, 'POST', { trackIds }) }
  async renamePlaylist(id: string, name: string) { return this.request(`/api/v1/playlists/${encodeURIComponent(id)}`, 'PATCH', { name }) }
  async deletePlaylist(id: string) { return this.request(`/api/v1/playlists/${encodeURIComponent(id)}`, 'DELETE') }
  async sources() { return this.request<SourceDto[]>('/api/v1/sources') }
  async enableSources(sourceIds: string[]) { return this.request<SourceDto[]>('/api/v1/sources/enabled', 'PUT', { sourceIds }) }
  async importSource(url: string) { return this.request('/api/v1/sources/import', 'POST', { url }) }
  async downloads(signal?: AbortSignal) { return this.request<DownloadDto[]>('/api/v1/downloads', 'GET', undefined, signal) }
  async download(track: TrackDto, quality: string, existingFilePolicy: 'error' | 'replace' | 'reuse' = 'error') { return this.request<DownloadDto>('/api/v1/downloads', 'POST', { musicInfo: track, quality, existingFilePolicy }) }
  async downloadAction(id: string, action: 'start' | 'pause' | 'resume') { return this.request(`/api/v1/downloads/${encodeURIComponent(id)}/${action}`, 'POST') }
  async deleteDownload(id: string) { return this.request(`/api/v1/downloads/${encodeURIComponent(id)}`, 'DELETE') }
  async library() { return this.request<LibraryDto[]>('/api/v1/library/tracks') }
  async deleteLibraryTrack(id: string) { return this.request(`/api/v1/library/tracks/${encodeURIComponent(id)}`, 'DELETE') }
  async settings() { return this.request<Record<string, unknown>>('/api/v1/settings') }
  async patchSettings(patch: Record<string, unknown>) { return this.request<Record<string, unknown>>('/api/v1/settings', 'PATCH', patch) }
}
