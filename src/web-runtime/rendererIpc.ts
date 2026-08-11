import defaultSetting from '../common/defaultSetting'
import defaultHotKey from '../common/defaultHotKey'
import { CMMON_EVENT_NAME, DISLIKE_EVENT_NAME, PLAYER_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } from '../common/ipcNames'
import { getWebCapabilities } from './capabilities'
import { WebEventTransport, type EventSourceConstructor } from './events'
import { createRequest } from './http'
import type { WebRuntime, WebRuntimeListener } from './types'

type Handler = (params?: unknown) => Promise<unknown>

export interface WebRuntimeDependencies {
  fetch?: typeof globalThis.fetch
  EventSource?: EventSourceConstructor
}

const unsupported = (name: string, code: 'UNSUPPORTED_IPC' | 'UNSUPPORTED_CAPABILITY', details?: unknown): Error & { code: string, details?: unknown } => Object.assign(
  new Error(`IPC '${name}' is not available in the web runtime`),
  { code, ...(details === undefined ? {} : { details }) },
)

export type IpcClassification =
  | { kind: 'route' }
  | { kind: 'event' }

const ipcClassifications = new Map<string, IpcClassification>()
const domainEvents = new Map<string, { type: string, select?: (data: unknown) => unknown }>([
  [WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, { type: 'settings.updated' }],
  [WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, {
    type: 'sources.update-available',
  }],
  ['service_downloads', { type: 'downloads.updated' }],
  [PLAYER_EVENT_NAME.list_add, { type: 'playlists.created' }],
  [PLAYER_EVENT_NAME.list_update, { type: 'playlists.updated' }],
  [PLAYER_EVENT_NAME.list_remove, { type: 'playlists.deleted' }],
  [PLAYER_EVENT_NAME.list_update_position, { type: 'playlists.reordered' }],
  [PLAYER_EVENT_NAME.list_data_overwire, { type: 'playlists.imported' }],
  [PLAYER_EVENT_NAME.list_music_add, { type: 'playlist.tracks.added' }],
  [PLAYER_EVENT_NAME.list_music_update, { type: 'playlist.tracks.updated' }],
  [PLAYER_EVENT_NAME.list_music_remove, { type: 'playlist.tracks.removed' }],
  [PLAYER_EVENT_NAME.list_music_update_position, { type: 'playlist.tracks.reordered' }],
  [PLAYER_EVENT_NAME.list_music_overwrite, { type: 'playlist.tracks.replaced' }],
  [PLAYER_EVENT_NAME.list_music_clear, { type: 'playlist.tracks.cleared' }],
  [PLAYER_EVENT_NAME.list_music_move, { type: 'playlist.tracks.moved' }],
])
const classify = (classification: IpcClassification, names: string[]): void => {
  for (const name of names) ipcClassifications.set(name, classification)
}

classify({ kind: 'route' }, [
  CMMON_EVENT_NAME.get_app_setting,
  CMMON_EVENT_NAME.set_app_setting,
  WIN_MAIN_RENDERER_EVENT_NAME.get_data,
  WIN_MAIN_RENDERER_EVENT_NAME.save_data,
  WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key,
  PLAYER_EVENT_NAME.list_get,
  PLAYER_EVENT_NAME.list_add,
  PLAYER_EVENT_NAME.list_remove,
  PLAYER_EVENT_NAME.list_update,
  PLAYER_EVENT_NAME.list_update_position,
  PLAYER_EVENT_NAME.list_music_get,
  PLAYER_EVENT_NAME.list_music_add,
  PLAYER_EVENT_NAME.list_music_move,
  PLAYER_EVENT_NAME.list_music_remove,
  PLAYER_EVENT_NAME.list_music_update,
  PLAYER_EVENT_NAME.list_music_update_position,
  PLAYER_EVENT_NAME.list_music_overwrite,
  PLAYER_EVENT_NAME.list_music_clear,
  PLAYER_EVENT_NAME.list_data_overwire,
  PLAYER_EVENT_NAME.list_music_check_exist,
  PLAYER_EVENT_NAME.list_music_get_list_ids,
  WIN_MAIN_RENDERER_EVENT_NAME.import_user_api,
  WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api,
  WIN_MAIN_RENDERER_EVENT_NAME.set_user_api,
  WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list,
  WIN_MAIN_RENDERER_EVENT_NAME.request_user_api,
  WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel,
  WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert,
  WIN_MAIN_RENDERER_EVENT_NAME.handle_request,
  WIN_MAIN_RENDERER_EVENT_NAME.cancel_request,
  WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset,
  WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset,
  WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset,
  WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset,
  WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric,
  WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw,
  WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw,
  WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited,
  WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited,
  WIN_MAIN_RENDERER_EVENT_NAME.remove_lyric_edited,
  WIN_MAIN_RENDERER_EVENT_NAME.get_music_url,
  WIN_MAIN_RENDERER_EVENT_NAME.save_music_url,
  DISLIKE_EVENT_NAME.get_dislike_music_infos,
  DISLIKE_EVENT_NAME.add_dislike_music_infos,
  DISLIKE_EVENT_NAME.overwrite_dislike_music_infos,
  DISLIKE_EVENT_NAME.clear_dislike_music_infos,
])
classify({ kind: 'event' }, [WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, 'service_downloads'])

export const classifyIpcName = (name: string): IpcClassification | null => ipcClassifications.get(name) ?? null

export const createWebRuntime = (dependencies: WebRuntimeDependencies = {}): WebRuntime => {
  const fetchImpl = dependencies.fetch ?? (async(...args) => globalThis.fetch(...args))
  const EventSourceImpl = dependencies.EventSource ?? globalThis.EventSource
  const request = createRequest(fetchImpl)
  const events = new WebEventTransport(request, EventSourceImpl)
  const appDataWrites = new Map<string, Promise<unknown>>()
  const localListeners = new Map<string, Set<WebRuntimeListener>>()
  const emitLocal = (name: string, params: unknown): void => {
    for (const listener of localListeners.get(name) ?? []) listener({ event: null, params })
  }
  const writeAppData = async(path: string, data: unknown): Promise<unknown> => {
    const previous = appDataWrites.get(path)
    const performWrite = async() => request('PUT', `/api/v1/client-data/${encodeURIComponent(path)}`, { value: data })
    const write = previous == null ? performWrite() : previous.catch(() => {}).then(performWrite)
    appDataWrites.set(path, write)
    return write.finally(() => {
      if (appDataWrites.get(path) === write) appDataWrites.delete(path)
    })
  }
  const readAppData = async<T>(path: string): Promise<T | null> => request<T | null>('GET', `/api/v1/client-data/${encodeURIComponent(path)}`)
  const lyricKey = (kind: 'raw' | 'edited', id: unknown): string => `web.lyric.${kind}.${String(id)}`
  const emptyLyric = (): LX.Music.LyricInfo => ({ lyric: '' })
  const getLyric = async(kind: 'raw' | 'edited', id: unknown): Promise<LX.Music.LyricInfo> => (await readAppData<LX.Music.LyricInfo>(lyricKey(kind, id))) ?? emptyLyric()
  const normalizeDislikeRules = (rules: string): string => Array.from(new Set(rules.split('\n').map(rule => rule.trim()).filter(Boolean))).join('\n')
  const getDislikeInfo = async(): Promise<LX.Dislike.DislikeInfo> => {
    const rules = (await readAppData<string>('web.dislike.rules')) ?? ''
    const names = new Set<string>()
    const musicNames = new Set<string>()
    const singerNames = new Set<string>()
    for (const rule of rules.split('\n')) {
      if (!rule) continue
      const [rawName = '', rawSinger = ''] = rule.split('@')
      const name = rawName.replaceAll('@', '#').toLocaleLowerCase().trim()
      const singer = rawSinger.replaceAll('@', '#').toLocaleLowerCase().trim()
      if (name && singer) names.add(`${name}@${singer}`)
      else if (name) musicNames.add(name)
      else if (singer) singerNames.add(singer)
    }
    return { names, musicNames, singerNames, rules }
  }
  const handlers = new Map<string, Handler>([
    [CMMON_EVENT_NAME.get_app_setting, async() => request('GET', '/api/v1/settings')],
    [CMMON_EVENT_NAME.set_app_setting, async params => request('PATCH', '/api/v1/settings', params)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key, async() => ({
      local: defaultHotKey.local,
      global: { enable: false, keys: {} },
    })],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_data, async key => request('GET', `/api/v1/client-data/${encodeURIComponent(String(key))}`)],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_data, async params => {
      const { path, data } = params as { path: string, data: unknown }
      return writeAppData(path, data)
    }],
    [PLAYER_EVENT_NAME.list_get, async() => request('GET', '/api/v1/playlists')],
    [PLAYER_EVENT_NAME.list_music_get, async id => {
      const list = await request<{ tracks: LX.Music.MusicInfo[] }>('GET', `/api/v1/playlists/${encodeURIComponent(String(id))}`)
      return list.tracks
    }],
    [PLAYER_EVENT_NAME.list_add, async params => {
      const value = params as LX.List.ListActionAdd
      return request('POST', '/api/v1/playlists', { position: value.position, playlists: value.listInfos })
    }],
    [PLAYER_EVENT_NAME.list_remove, async params => {
      await Promise.all((params as string[]).map(async id => request('DELETE', `/api/v1/playlists/${encodeURIComponent(id)}`)))
      return request('GET', '/api/v1/playlists')
    }],
    [PLAYER_EVENT_NAME.list_update, async params => request('PATCH', '/api/v1/playlists', { playlists: params })],
    [PLAYER_EVENT_NAME.list_update_position, async params => request('POST', '/api/v1/playlists/reorder', params)],
    [PLAYER_EVENT_NAME.list_music_add, async params => {
      const value = params as LX.List.ListActionMusicAdd
      return request('POST', `/api/v1/playlists/${encodeURIComponent(value.id)}/tracks`, { tracks: value.musicInfos, position: value.addMusicLocationType })
    }],
    [PLAYER_EVENT_NAME.list_music_move, async params => request('POST', '/api/v1/playlists/tracks/move', params)],
    [PLAYER_EVENT_NAME.list_music_remove, async params => {
      const value = params as LX.List.ListActionMusicRemove
      return request('POST', `/api/v1/playlists/${encodeURIComponent(value.listId)}/tracks/remove`, { trackIds: value.ids })
    }],
    [PLAYER_EVENT_NAME.list_music_update, async params => {
      const grouped = new Map<string, LX.Music.MusicInfo[]>()
      for (const update of params as LX.List.ListActionMusicUpdate) {
        const tracks = grouped.get(update.id) ?? []
        tracks.push(update.musicInfo)
        grouped.set(update.id, tracks)
      }
      return Promise.all([...grouped].map(async([id, tracks]) => request('PATCH', `/api/v1/playlists/${encodeURIComponent(id)}/tracks`, { tracks })))
    }],
    [PLAYER_EVENT_NAME.list_music_update_position, async params => {
      const value = params as LX.List.ListActionMusicUpdatePosition
      return request('POST', `/api/v1/playlists/${encodeURIComponent(value.listId)}/tracks/reorder`, { position: value.position, trackIds: value.ids })
    }],
    [PLAYER_EVENT_NAME.list_music_overwrite, async params => {
      const value = params as LX.List.ListActionMusicOverwrite
      return request('PUT', `/api/v1/playlists/${encodeURIComponent(value.listId)}/tracks`, { tracks: value.musicInfos })
    }],
    [PLAYER_EVENT_NAME.list_music_clear, async params => Promise.all((params as string[]).map(async id => request('DELETE', `/api/v1/playlists/${encodeURIComponent(id)}/tracks`)))],
    [PLAYER_EVENT_NAME.list_data_overwire, async params => request('POST', '/api/v1/playlists/import', params)],
    [PLAYER_EVENT_NAME.list_music_check_exist, async params => {
      const value = params as LX.List.ListActionCheckMusicExistList
      return request('GET', `/api/v1/playlists/${encodeURIComponent(value.listId)}/tracks/${encodeURIComponent(value.musicInfoId)}/exists`)
    }],
    [PLAYER_EVENT_NAME.list_music_get_list_ids, async params => request('GET', `/api/v1/tracks/${encodeURIComponent(String(params))}/playlists`)],
    [WIN_MAIN_RENDERER_EVENT_NAME.import_user_api, async params => {
      const apiInfo = await request('POST', '/api/v1/sources', { script: params })
      const apiList = await request('GET', '/api/v1/sources')
      return { apiInfo, apiList }
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api, async params => {
      await Promise.all((params as string[]).map(async id => request('DELETE', `/api/v1/sources/${encodeURIComponent(id)}`)))
      return request('GET', '/api/v1/sources')
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, async params => {
      if (!String(params).startsWith('user_api_')) return
      const apiInfo = await request<any>('PUT', '/api/v1/sources/active', { sourceId: String(params) })
      emitLocal(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, { status: true, apiInfo })
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list, async() => request('GET', '/api/v1/sources')],
    [WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert, async() => undefined],
    [WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, async params => {
      const requestParams = params as { data?: { source?: unknown, action?: unknown, info?: { type?: unknown, musicInfo?: unknown } } }
      const data = requestParams?.data
      if (data == null || typeof data.source !== 'string' || data.info?.musicInfo == null) {
        throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, 'UNSUPPORTED_IPC')
      }
      let result: unknown
      switch (data.action) {
        case 'musicUrl':
          if (typeof data.info.type !== 'string') throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, 'UNSUPPORTED_IPC')
          result = await request('POST', '/api/v1/playback/tracks/resolve', { source: data.source, info: data.info, quality: data.info.type })
          break
        case 'lyric':
          result = await request('POST', '/api/v1/catalog/tracks/lyrics', { source: data.source, musicInfo: data.info.musicInfo })
          break
        case 'pic':
          result = await request('POST', '/api/v1/catalog/tracks/picture', { source: data.source, musicInfo: data.info.musicInfo })
          break
        default:
          throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, 'UNSUPPORTED_IPC')
      }
      return { data: result }
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.handle_request, async params => {
      const search = params as { kind?: unknown, source?: unknown, text?: unknown, page?: unknown, limit?: unknown }
      if (search == null || search.kind !== 'provider-search' || typeof search.source !== 'string' || typeof search.text !== 'string' || !Number.isInteger(search.page) || !Number.isInteger(search.limit)) throw unsupported(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, 'UNSUPPORTED_IPC')
      return request('POST', '/api/v1/catalog/tracks/search', { source: search.source, text: search.text, page: search.page, pageSize: search.limit })
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset, async() => (await readAppData<LX.SoundEffect.EQPreset[]>('web.soundEffect.eqPresets')) ?? []],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset, async params => writeAppData('web.soundEffect.eqPresets', params)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset, async() => (await readAppData<LX.SoundEffect.ConvolutionPreset[]>('web.soundEffect.convolutionPresets')) ?? []],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset, async params => writeAppData('web.soundEffect.convolutionPresets', params)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw, async id => getLyric('raw', id)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited, async id => getLyric('edited', id)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, async id => {
      const [raw, edited] = await Promise.all([getLyric('raw', id), getLyric('edited', id)])
      return edited.lyric ? { ...edited, rawlrcInfo: raw } : { ...raw, rawlrcInfo: raw }
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, async params => {
      const { id, lyrics } = params as LX.Music.LyricInfoSave
      return writeAppData(lyricKey('raw', id), lyrics)
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited, async params => {
      const { id, lyrics } = params as LX.Music.LyricInfoSave
      return writeAppData(lyricKey('edited', id), lyrics)
    }],
    [WIN_MAIN_RENDERER_EVENT_NAME.remove_lyric_edited, async id => writeAppData(lyricKey('edited', id), null)],
    [WIN_MAIN_RENDERER_EVENT_NAME.get_music_url, async id => (await readAppData<string>(`web.musicUrl.${String(id)}`)) ?? ''],
    [WIN_MAIN_RENDERER_EVENT_NAME.save_music_url, async params => {
      const { id, url } = params as LX.Music.MusicUrlInfo
      return writeAppData(`web.musicUrl.${id}`, url)
    }],
    [DISLIKE_EVENT_NAME.get_dislike_music_infos, getDislikeInfo],
    [DISLIKE_EVENT_NAME.add_dislike_music_infos, async params => {
      const current = await getDislikeInfo()
      const added = (params as LX.Dislike.DislikeMusicInfo[]).map(info => `${info.name ?? ''}@${info.singer ?? ''}`)
      const rules = normalizeDislikeRules([current.rules, ...added].filter(Boolean).join('\n'))
      await writeAppData('web.dislike.rules', rules)
      emitLocal(DISLIKE_EVENT_NAME.add_dislike_music_infos, params)
    }],
    [DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, async params => {
      const rules = normalizeDislikeRules(String(params))
      await writeAppData('web.dislike.rules', rules)
      emitLocal(DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, rules)
    }],
    [DISLIKE_EVENT_NAME.clear_dislike_music_infos, async() => {
      await writeAppData('web.dislike.rules', '')
      emitLocal(DISLIKE_EVENT_NAME.clear_dislike_music_infos, undefined)
    }],
  ])

  const invoke: WebRuntime['invoke'] = async<T>(name: string, params?: unknown): Promise<T> => {
    const handler = handlers.get(name)
    if (handler != null) return handler(params) as Promise<T>
    throw unsupported(name, 'UNSUPPORTED_IPC')
  }

  return {
    capabilities: getWebCapabilities(),
    invoke,
    send(name, params) {
      if (name === WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel) return
      const handler = handlers.get(name)
      if (handler == null) {
        throw unsupported(name, 'UNSUPPORTED_IPC')
      }
      void handler(params).catch(error => {
        console.error(error)
      })
    },
    on: (name, listener) => {
      const classification = classifyIpcName(name)
      if (classification == null) throw unsupported(name, 'UNSUPPORTED_IPC')
      let listeners = localListeners.get(name)
      if (listeners == null) localListeners.set(name, listeners = new Set())
      listeners.add(listener as WebRuntimeListener)
      const domain = domainEvents.get(name)
      events.on(name, listener, domain?.type, domain?.select)
    },
    off: (name, listener) => {
      localListeners.get(name)?.delete(listener as WebRuntimeListener)
      events.off(name, listener)
    },
    offAll: name => {
      localListeners.delete(name)
      events.offAll(name)
    },
    close: () => {
      events.close()
    },
  }
}

let runtime: WebRuntime | undefined
export const getWebRuntime = (): WebRuntime => runtime ??= createWebRuntime()

export function rendererSend(name: string): void
export function rendererSend<T>(name: string, params: T): void
export function rendererSend<T>(name: string, params?: T): void {
  getWebRuntime().send(name, params)
}

export function rendererSendSync(name: string): void
export function rendererSendSync<T>(name: string, params: T): void
export function rendererSendSync<T>(name: string, _params?: T): void {
  throw unsupported(name, 'UNSUPPORTED_IPC')
}

export function rendererInvoke(name: string): Promise<void>
export function rendererInvoke<V>(name: string): Promise<V>
export function rendererInvoke<T>(name: string, params: T): Promise<void>
export function rendererInvoke<T, V>(name: string, params: T): Promise<V>
export async function rendererInvoke<T, V>(name: string, params?: T): Promise<V> {
  return getWebRuntime().invoke<V>(name, params)
}

export function rendererOn(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  getWebRuntime().on(name, listener as WebRuntimeListener<T>)
}

export function rendererOnce(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  const wrapped: LX.IpcRendererEventListenerParams<T> = payload => {
    getWebRuntime().off(name, wrapped as WebRuntimeListener<T>)
    listener(payload)
  }
  getWebRuntime().on(name, wrapped as WebRuntimeListener<T>)
}

export const rendererOff = (name: string, listener: (...args: any[]) => any) => {
  getWebRuntime().off(name, listener)
}

export const rendererOffAll = (_name: string) => {
  getWebRuntime().offAll(_name)
}

export default defaultSetting
