import defaultSetting from '@common/defaultSetting'
import defaultHotKey from '@common/defaultHotKey'
import themes from '@common/theme/index.json'
import { unavailable } from './unavailable'
import { applyWebTheme } from './theme'
import { sharedAccounts } from '../../../../packages/service-client/src/accounts'
import { ServiceClient } from '../../../../packages/service-client/src/client'
const accounts = () => sharedAccounts(new ServiceClient(location.origin))

const prefix = 'qmusic.web.v1.'
const read = (key: string, fallback: any = null) => { try { return JSON.parse(localStorage.getItem(prefix + key) ?? 'null') ?? fallback } catch { return fallback } }
const write = (key: string, value: any) => { localStorage.setItem(prefix + key, JSON.stringify(value)) }
const listeners = new Map<string, Set<(...args: any[]) => void>>()
const emit = (name: string, value: any) => { for (const listener of listeners.get(name) ?? []) listener(null, value) }

const invoke = async(name: string, params?: any): Promise<any> => {
  switch (name) {
    case 'common_get_app_setting': {
      const settings = { ...defaultSetting, 'common.isAutoCheckUpdate': false, 'desktopLyric.enable': false, ...read('settings', {}) }
      emit('common_theme_change', applyWebTheme(settings))
      return settings
    }
    case 'common_set_app_setting': {
      // UI preferences belong to this browser. Shared download settings use ServiceSettings.
      const local = Object.fromEntries(Object.entries(params).filter(([key]) => key in defaultSetting && !key.startsWith('download.')))
      write('settings', { ...read('settings', {}), ...local })
      emit('winMain_on_config_change', local)
      if (Object.keys(local).some(key => key.startsWith('theme.'))) emit('common_theme_change', applyWebTheme({ ...defaultSetting, ...read('settings', {}) }))
      return
    }
    case 'common_get_env_params': return { cmdParams: {}, envParams: {}, deeplink: '', urls: [] }
    case 'common_get_system_fonts': return []
    case 'winMain_get_hot_key': return { local: defaultHotKey.local, global: { enable: false, keys: {} } }
    case 'winMain_get_data': return read('data.' + params)
    case 'winMain_save_data': write('data.' + params.path, params.data); return
    case 'winMain_get_themes': return { themes, userThemes: read('themes', []), dataPath: '' }
    case 'winMain_get_other_source': return []
    case 'winMain_get_other_source_count':
    case 'winMain_get_cache_size':
    case 'winMain_get_lyric_raw_count':
    case 'winMain_get_lyric_edited_count': return 0
    case 'winMain_get_palyer_lyric':
    case 'winMain_get_lyric_raw':
    case 'winMain_get_lyric_edited': return { lyric: '' }
    case 'winMain_get_music_url': return ''
    case 'winMain_get_sound_effect_eq_preset': return read('eq', [])
    case 'winMain_get_sound_effect_convolution_preset': return read('convolution', [])
    case 'winMain_music_account_status': return accounts().status()
    case 'winMain_music_account_login': return accounts().login(params)
    case 'winMain_music_account_daily': return accounts().daily(params)
    case 'winMain_music_account_playlists': return accounts().playlists(params)
    case 'winMain_music_account_playback_report': return { status: 'unsupported' }
    case 'winMain_fullscreen': {
      if (params) await document.documentElement.requestFullscreen()
      else if (document.fullscreenElement) await document.exitFullscreen()
      return !!document.fullscreenElement
    }
    case 'dislike_get_dislike_music_infos': {
      const rules: string = read('dislike', '')
      const names = new Set<string>(); const musicNames = new Set<string>(); const singerNames = new Set<string>()
      for (const rule of rules.split('\n').filter(Boolean)) { const [name, singer] = rule.toLowerCase().split('@'); if (name && singer) names.add(`${name}@${singer}`); else if (name) musicNames.add(name); else if (singer) singerNames.add(singer) }
      return { names, musicNames, singerNames, rules }
    }
    case 'dislike_overwrite_dislike_music_infos': write('dislike', params); return
    case 'dislike_clear_dislike_music_infos': write('dislike', ''); return
    case 'dislike_add_dislike_music_infos': {
      const rules = [read('dislike', ''), ...params.map((item: any) => `${item.name ?? ''}@${item.singer ?? ''}`)].filter(Boolean).join('\n'); write('dislike', rules); return
    }
    case 'winMain_open_api_action': return { address: '', message: 'Web 由当前 Service 提供接口' }
    case 'winMain_sync_action': return { status: false }
    case 'winMain_set_user_api':
    case 'winMain_save_other_source':
    case 'winMain_clear_other_source':
    case 'winMain_save_music_url':
    case 'winMain_remove_music_url': return
    case 'winMain_show_save_dialog': return { canceled: false, filePath: params.defaultPath?.split('/').pop() || 'qmusic-export' }
    default: return unavailable(name)
  }
}
const silent = new Set(['winMain_inited', 'winMain_player_status', 'winMain_player_action_set_buttons', 'winMain_set_ignore_mouse_events', 'winMain_set_power_save_blocker', 'winMain_set_window_size', 'winMain_change_tray', 'winMain_set_app_name', 'common_clear_env_params_deeplink'])
export const ipcRenderer = {
  invoke,
  send(name: string, params?: any) {
    if (silent.has(name)) return
    if (name === 'winMain_restart_window') { location.reload(); return }
    void invoke(name, params).catch(error => { console.error(error) })
  },
  sendSync: (name: string) => unavailable(name),
  on(name: string, callback: (...args: any[]) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback) },
  once(name: string, callback: (...args: any[]) => void) { const once = (...args: any[]) => { ipcRenderer.removeListener(name, once); callback(...args) }; ipcRenderer.on(name, once) },
  removeListener(name: string, callback: (...args: any[]) => void) { listeners.get(name)?.delete(callback) },
  removeAllListeners(name: string) { listeners.delete(name) },
}
export const shell = { openExternal: async(url: string) => { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer') }, showItemInFolder: () => unavailable('本机文件管理器') }
const copyWithSelection = (text: string) => {
  const previous = document.activeElement as HTMLElement | null
  const input = document.createElement('textarea')
  input.value = text
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  input.setAttribute('aria-hidden', 'true')
  document.body.appendChild(input)
  try { input.select(); document.execCommand('copy') } finally { input.remove(); previous?.focus({ preventScroll: true }) }
}
export const clipboard = {
  writeText: (text: string) => {
    // The asynchronous clipboard API is unavailable on ordinary HTTP origins.
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => { copyWithSelection(text) })
    else copyWithSelection(text)
  },
  readText: () => '',
}
