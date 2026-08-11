import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CMMON_EVENT_NAME,
  DISLIKE_EVENT_NAME,
  PLAYER_EVENT_NAME,
  WIN_MAIN_RENDERER_EVENT_NAME,
} from '../common/ipcNames'
import { WebRuntimeError } from './http'
import { classifyIpcName, createWebRuntime } from './rendererIpc'
import type { WebRuntime } from './types'

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
)

const deferred = <T>() => {
  let resolveDeferred!: (value: T) => void
  let rejectDeferred!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  onopen: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void): void {
    let listeners = this.listeners.get(name)
    if (listeners == null) this.listeners.set(name, listeners = new Set())
    listeners.add(listener)
  }

  removeEventListener(name: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(name)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  emit(name: string, params: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(params) })
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }

  listenerCount(name: string): number {
    return this.listeners.get(name)?.size ?? 0
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  FakeEventSource.instances.length = 0
})

describe('typed Web runtime HTTP transport', () => {
  it('maps setting reads and patches to the versioned settings route', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { 'player.volume': 0.7 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { 'player.volume': 0.4 } }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await expect(runtime.invoke(CMMON_EVENT_NAME.get_app_setting)).resolves.toEqual({ 'player.volume': 0.7 })
    await expect(runtime.invoke(CMMON_EVENT_NAME.set_app_setting, { 'player.volume': 0.4 })).resolves.toEqual({ 'player.volume': 0.4 })

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/settings', {
      method: 'GET',
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'player.volume': 0.4 }),
    })
  })

  it('activates a source through the typed active-source resource', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ data: { id: 'user_api_fixture', active: true } }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, 'user_api_fixture')

    expect(fetch).toHaveBeenCalledWith('/api/v1/sources/active', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: 'user_api_fixture' }),
    })
  })

  it('rejects unknown IPC locally without making a request', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await expect(runtime.invoke('not_registered')).rejects.toMatchObject({ code: 'UNSUPPORTED_IPC' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('decodes stable API errors into WebRuntimeError fields', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      error: { code: 'INVALID_SETTING', message: 'Unknown setting', details: { key: 'missing' } },
    }, 400))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    const error = await runtime.invoke(CMMON_EVENT_NAME.set_app_setting, { missing: true }).catch(error => error)
    expect(error).toBeInstanceOf(WebRuntimeError)
    expect(error).toMatchObject({ code: 'INVALID_SETTING', status: 400, details: { key: 'missing' } })
  })

  it('normalizes fetch rejection into a stable network error', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('connection reset'))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    const error = await runtime.invoke(CMMON_EVENT_NAME.get_app_setting).catch(error => error)
    expect(error).toBeInstanceOf(WebRuntimeError)
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0, details: { cause: 'connection reset' } })
  })

  it('maps app data and list reads without retaining desktop bootstrap or download IPC', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { url: '/search', query: {} } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'roadtrip', name: 'Road trip', locationUpdateTime: null }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'roadtrip', name: 'Road trip', locationUpdateTime: null, tracks: [{ id: 'track-1' }] } }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await expect(runtime.invoke(CMMON_EVENT_NAME.get_env_params)).rejects.toMatchObject({ code: 'UNSUPPORTED_IPC' })
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_data, 'viewPrevState')).resolves.toEqual({ url: '/search', query: {} })
    await expect(runtime.invoke(PLAYER_EVENT_NAME.list_get)).resolves.toHaveLength(1)
    await expect(runtime.invoke(PLAYER_EVENT_NAME.list_music_get, 'roadtrip')).resolves.toEqual([{ id: 'track-1' }])
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.download_list_get)).rejects.toMatchObject({ code: 'UNSUPPORTED_IPC' })
  })

  it('keeps local in-page shortcuts while disabling global hotkeys', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key)).resolves.toMatchObject({
      local: { enable: true, keys: { 'mod+f5': { action: 'player_toggle_play' } } },
      global: { enable: false, keys: {} },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps list batches onto playlist resources without legacy action routes', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async() => jsonResponse({ data: null }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const add = {
      position: 1,
      listInfos: [
        { id: 'b', name: 'B', locationUpdateTime: null },
        { id: 'd', name: 'D', locationUpdateTime: null },
      ],
    }
    const update = [
      { id: 'b', name: 'B2', locationUpdateTime: null },
      { id: 'd', name: 'D2', locationUpdateTime: null },
    ]
    const remove = ['b', 'd']

    await runtime.invoke(PLAYER_EVENT_NAME.list_add, add)
    await runtime.invoke(PLAYER_EVENT_NAME.list_update, update)
    await runtime.invoke(PLAYER_EVENT_NAME.list_remove, remove)

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/playlists', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position: add.position, playlists: add.listInfos }),
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/playlists', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playlists: update }),
    })
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/v1/playlists/b', { method: 'DELETE' })
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/v1/playlists/d', { method: 'DELETE' })
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/v1/playlists', { method: 'GET' })
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it.each([
    [PLAYER_EVENT_NAME.list_update_position, 'POST', '/api/v1/playlists/reorder', { position: 0, ids: ['b', 'a'] }, { position: 0, ids: ['b', 'a'] }],
    [PLAYER_EVENT_NAME.list_music_add, 'POST', '/api/v1/playlists/a/tracks', { id: 'a', musicInfos: [], addMusicLocationType: 'top' }, { tracks: [], position: 'top' }],
    [PLAYER_EVENT_NAME.list_music_move, 'POST', '/api/v1/playlists/tracks/move', { fromId: 'a', toId: 'b', musicInfos: [], addMusicLocationType: 'bottom' }, { fromId: 'a', toId: 'b', musicInfos: [], addMusicLocationType: 'bottom' }],
    [PLAYER_EVENT_NAME.list_music_remove, 'POST', '/api/v1/playlists/a/tracks/remove', { listId: 'a', ids: ['track'] }, { trackIds: ['track'] }],
    [PLAYER_EVENT_NAME.list_music_update, 'PATCH', '/api/v1/playlists/a/tracks', [{ id: 'a', musicInfo: { id: 'track' } }], { tracks: [{ id: 'track' }] }],
    [PLAYER_EVENT_NAME.list_music_update_position, 'POST', '/api/v1/playlists/a/tracks/reorder', { listId: 'a', position: 0, ids: ['track'] }, { position: 0, trackIds: ['track'] }],
    [PLAYER_EVENT_NAME.list_music_overwrite, 'PUT', '/api/v1/playlists/a/tracks', { listId: 'a', musicInfos: [] }, { tracks: [] }],
    [PLAYER_EVENT_NAME.list_data_overwire, 'POST', '/api/v1/playlists/import', { defaultList: [], loveList: [], userList: [] }, { defaultList: [], loveList: [], userList: [] }],
  ])('maps list action %s to a resource contract', async(name, method, path, params, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async() => jsonResponse({ data: null }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await runtime.invoke(name, params)

    expect(fetch).toHaveBeenCalledWith(path, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('fans out playlist track clears and uses resource membership lookups', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async() => jsonResponse({ data: null }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await runtime.invoke(PLAYER_EVENT_NAME.list_music_clear, ['a', 'b'])
    await runtime.invoke(PLAYER_EVENT_NAME.list_music_check_exist, { listId: 'a', musicInfoId: 'track' })
    await runtime.invoke(PLAYER_EVENT_NAME.list_music_get_list_ids, 'track')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/playlists/a/tracks', { method: 'DELETE' })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/playlists/b/tracks', { method: 'DELETE' })
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/v1/playlists/a/tracks/track/exists', { method: 'GET' })
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/v1/tracks/track/playlists', { method: 'GET' })
  })

  it.each([
    WIN_MAIN_RENDERER_EVENT_NAME.get_themes,
    WIN_MAIN_RENDERER_EVENT_NAME.open_api_action,
    WIN_MAIN_RENDERER_EVENT_NAME.sync_action,
    CMMON_EVENT_NAME.get_system_fonts,
    PLAYER_EVENT_NAME.invoke_toggle_play,
    WIN_MAIN_RENDERER_EVENT_NAME.download_list_get,
    WIN_MAIN_RENDERER_EVENT_NAME.fullscreen,
  ])('does not retain a desktop IPC classification for %s', async(name) => {
    const runtime = createWebRuntime({ fetch: vi.fn<typeof globalThis.fetch>(), EventSource: FakeEventSource })
    expect(classifyIpcName(name)).toBeNull()
    await expect(runtime.invoke(name)).rejects.toMatchObject({ code: 'UNSUPPORTED_IPC' })
  })

  it('serializes fire-and-forget app-data writes for the same key', async() => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    runtime.send(WIN_MAIN_RENDERER_EVENT_NAME.save_data, { path: 'viewPrevState', data: { url: '/first' } })
    runtime.send(WIN_MAIN_RENDERER_EVENT_NAME.save_data, { path: 'viewPrevState', data: { url: '/second' } })
    expect(fetch).toHaveBeenCalledOnce()

    first.resolve(jsonResponse({ data: { url: '/first' } }))
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })
    second.resolve(jsonResponse({ data: { url: '/second' } }))
  })

  it('persists retained sound-effect presets through Service client data', async() => {
    const values = new Map<string, unknown>()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async(input, init) => {
      const key = decodeURIComponent(String(input).split('/').at(-1) ?? '')
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { value: unknown }
        values.set(key, body.value)
        return jsonResponse({ data: body.value })
      }
      return jsonResponse({ data: values.get(key) ?? null })
    })
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const eq = [{ id: 'voice', name: 'Voice', hz31: 1 }]
    const convolution = [{ id: 'hall', name: 'Hall', source: 'fixture' }]

    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset)).resolves.toEqual([])
    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset, eq)
    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset, convolution)
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset)).resolves.toEqual(eq)
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset)).resolves.toEqual(convolution)
  })

  it('preserves edited lyric precedence and raw lyric fallback in Service client data', async() => {
    const values = new Map<string, unknown>()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async(input, init) => {
      const key = decodeURIComponent(String(input).split('/').at(-1) ?? '')
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { value: unknown }
        values.set(key, body.value)
        return jsonResponse({ data: body.value })
      }
      return jsonResponse({ data: values.get(key) ?? null })
    })
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const raw = { lyric: '[00:01.000]raw' }
    const edited = { lyric: '[00:01.000]edited' }

    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, { id: 'track', lyrics: raw })
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, 'track')).resolves.toEqual({ ...raw, rawlrcInfo: raw })
    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited, { id: 'track', lyrics: edited })
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, 'track')).resolves.toEqual({ ...edited, rawlrcInfo: raw })
    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.remove_lyric_edited, 'track')
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, 'track')).resolves.toEqual({ ...raw, rawlrcInfo: raw })
  })

  it('persists the retained URL cache and dislike rules without desktop IPC', async() => {
    const values = new Map<string, unknown>()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async(input, init) => {
      const key = decodeURIComponent(String(input).split('/').at(-1) ?? '')
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { value: unknown }
        values.set(key, body.value)
        return jsonResponse({ data: body.value })
      }
      return jsonResponse({ data: values.get(key) ?? null })
    })
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.save_music_url, { id: 'track_hq', url: 'https://fixture/audio' })
    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url, 'track_hq')).resolves.toBe('https://fixture/audio')
    await runtime.invoke(DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, 'song@artist')
    await expect(runtime.invoke(DISLIKE_EVENT_NAME.get_dislike_music_infos)).resolves.toMatchObject({ rules: 'song@artist' })
  })

  it.each([
    ['musicUrl', '/api/v1/playback/tracks/resolve', { source: 'kw', info: { type: '128k', musicInfo: { id: 'track' } }, quality: '128k' }],
    ['lyric', '/api/v1/catalog/tracks/lyrics', { source: 'kw', musicInfo: { id: 'track' } }],
    ['pic', '/api/v1/catalog/tracks/picture', { source: 'kw', musicInfo: { id: 'track' } }],
  ])('routes retained custom-source %s requests through the Service', async(action, url, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ data: { url: '/api/v1/streams/token' } }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })

    await expect(runtime.invoke(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, {
      requestKey: 'request_fixture',
      data: { source: 'kw', action, info: { type: '128k', musicInfo: { id: 'track' } } },
    })).resolves.toEqual({ data: { url: '/api/v1/streams/token' } })
    expect(fetch).toHaveBeenCalledWith(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  })

  it('classifies every maintained renderer IPC facade consumer', () => {
    const roots = [
      'src/renderer/utils/ipc.ts',
      'src/renderer/core/dislikeList.ts',
      'src/renderer/store/list/listManage/rendererListManage.ts',
    ]
    const groups = { CMMON_EVENT_NAME, DISLIKE_EVENT_NAME, PLAYER_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME }
    const missing: string[] = []
    for (const relativePath of roots) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8').replace(/\/\/.*$/gm, '')
      for (const match of source.matchAll(/\b(CMMON_EVENT_NAME|DISLIKE_EVENT_NAME|PLAYER_EVENT_NAME|WIN_MAIN_RENDERER_EVENT_NAME)\.([A-Za-z0-9_]+)/g)) {
        const [, groupName, key] = match
        const value = groups[groupName as keyof typeof groups][key as never] as string | undefined
        if (value != null && classifyIpcName(value) == null) missing.push(`${relativePath}:${groupName}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('typed Web runtime event transport', () => {
  it('delivers named SSE messages in renderer event shape and removes listeners cleanly', () => {
    const runtime = createWebRuntime({ fetch: vi.fn<typeof globalThis.fetch>(), EventSource: FakeEventSource })
    const listener = vi.fn()

    runtime.on(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
    const source = FakeEventSource.instances[0]
    expect(source.url).toBe('/api/v1/events')
    source.emit('settings.updated', { type: 'settings.updated', data: { 'player.volume': 0.5 }, sequence: 1 })
    expect(listener).toHaveBeenCalledWith({ event: null, params: { 'player.volume': 0.5 } })

    runtime.off(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
    expect(source.listenerCount('settings.updated')).toBe(0)
    expect(source.closed).toBe(true)
  })

  it('fetches and dispatches the event snapshot after a native reconnect', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      data: { sequence: 1, events: [{ type: 'playlists.updated', data: [{ id: 'download-1' }], sequence: 1 }] },
    }))
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const listener = vi.fn()
    runtime.on(PLAYER_EVENT_NAME.list_update, listener)
    const source = FakeEventSource.instances[0]

    source.open()
    expect(fetch).not.toHaveBeenCalled()
    source.open()
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ event: null, params: [{ id: 'download-1' }] })
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/events/snapshot', {
      method: 'GET',
    })
  })

  it('applies a delayed reconnect snapshot before queued newer live events', async() => {
    const snapshot = deferred<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(snapshot.promise)
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const received: unknown[] = []
    runtime.on(PLAYER_EVENT_NAME.list_update, ({ params }) => received.push(params))
    const source = FakeEventSource.instances[0]
    source.open()
    source.open()
    source.emit('playlists.updated', { type: 'playlists.updated', data: ['live'], sequence: 2 })
    expect(received).toEqual([])

    snapshot.resolve(jsonResponse({ data: { sequence: 1, events: [{ type: 'playlists.updated', data: ['snapshot'], sequence: 1 }] } }))
    await vi.waitFor(() => {
      expect(received).toEqual([['snapshot'], ['live']])
    })
  })

  it('discards obsolete snapshots but retains all live events when reconnects overlap', async() => {
    const oldSnapshot = deferred<Response>()
    const currentSnapshot = deferred<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(currentSnapshot.promise)
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const received: unknown[] = []
    runtime.on(PLAYER_EVENT_NAME.list_update, ({ params }) => received.push(params))
    const source = FakeEventSource.instances[0]
    source.open()
    source.open()
    source.emit('playlists.updated', { type: 'playlists.updated', data: ['obsolete-live'], sequence: 2 })
    source.open()
    source.emit('playlists.updated', { type: 'playlists.updated', data: ['current-live'], sequence: 3 })

    oldSnapshot.resolve(jsonResponse({ data: { sequence: 1, events: [{ type: 'playlists.updated', data: ['old'], sequence: 1 }] } }))
    await Promise.resolve()
    expect(received).toEqual([])
    currentSnapshot.resolve(jsonResponse({ data: { sequence: 1, events: [{ type: 'playlists.updated', data: ['current'], sequence: 1 }] } }))
    await vi.waitFor(() => {
      expect(received).toEqual([['current'], ['obsolete-live'], ['current-live']])
    })
  })

  it('never applies a delayed snapshot from a closed lifetime after reopening', async() => {
    const oldSnapshot = deferred<Response>()
    const currentSnapshot = deferred<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(currentSnapshot.promise)
    const runtime = createWebRuntime({ fetch, EventSource: FakeEventSource })
    const received: unknown[] = []
    runtime.on(PLAYER_EVENT_NAME.list_update, ({ params }) => received.push(['old-listener', params]))
    const oldSource = FakeEventSource.instances[0]
    oldSource.open()
    oldSource.open()

    runtime.close()
    runtime.on(PLAYER_EVENT_NAME.list_update, ({ params }) => received.push(params))
    const currentSource = FakeEventSource.instances[1]
    currentSource.open()
    currentSource.open()
    currentSource.emit('playlists.updated', { type: 'playlists.updated', data: ['current-live'], sequence: 2 })

    oldSnapshot.resolve(jsonResponse({ data: { sequence: 1, events: [{ type: 'playlists.updated', data: ['old'], sequence: 1 }] } }))
    await Promise.resolve()
    expect(received).toEqual([])

    currentSnapshot.resolve(jsonResponse({ data: { sequence: 1, events: [{ type: 'playlists.updated', data: ['current'], sequence: 1 }] } }))
    await vi.waitFor(() => {
      expect(received).toEqual([['current'], ['current-live']])
    })
  })

  it('rendererOffAll removes only the requested event name', () => {
    const runtime = createWebRuntime({ fetch: vi.fn<typeof globalThis.fetch>(), EventSource: FakeEventSource }) as WebRuntime & { offAll: (name: string) => void }
    const first = vi.fn()
    const second = vi.fn()
    runtime.on(PLAYER_EVENT_NAME.list_add, first)
    runtime.on(PLAYER_EVENT_NAME.list_remove, second)
    const source = FakeEventSource.instances[0]

    runtime.offAll(PLAYER_EVENT_NAME.list_add)
    expect(source.listenerCount('playlists.created')).toBe(0)
    expect(source.listenerCount('playlists.deleted')).toBe(1)
    expect(source.closed).toBe(false)
    source.emit('playlists.deleted', { type: 'playlists.deleted', data: 2, sequence: 1 })
    expect(second).toHaveBeenCalledWith({ event: null, params: 2 })
  })
})
