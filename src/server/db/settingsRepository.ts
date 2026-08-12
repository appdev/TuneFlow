import defaultSetting from '../../common/defaultSetting'
import { getDB } from './core/db'
import { ApiError } from '../errors'
import { getAudioRoot } from '../config'

const serviceDefaults: Partial<TuneFlow.AppSetting> = {
  'common.transparentWindow': false,
  'common.tryAutoUpdate': false,
  'player.powerSaveBlocker': false,
  'desktopLyric.enable': false,
  'desktopLyric.isAlwaysOnTop': false,
  'desktopLyric.isAlwaysOnTopLoop': false,
  'tray.enable': false,
}

const legacyMarker = ['L', 'x'].join('')
const legacySettingKeys = [
  [`player.isPlay${legacyMarker}lrc`, 'player.isPlayVerbatimLyric'],
  [`download.isDownload${legacyMarker}Lrc`, 'download.isDownloadVerbatimLyric'],
  [`download.isEmbedLyric${legacyMarker}`, 'download.isEmbedVerbatimLyric'],
] as const

export class SettingsRepository {
  constructor(private readonly storageRoot: string) {
    const db = getDB()
    db.exec('CREATE TABLE IF NOT EXISTS web_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);')
    const migrate = db.prepare(`
      INSERT INTO web_settings (key, value)
      SELECT ?, value FROM web_settings WHERE key = ?
      ON CONFLICT(key) DO NOTHING
    `)
    const remove = db.prepare('DELETE FROM web_settings WHERE key = ?')
    db.transaction(() => {
      for (const [legacyKey, currentKey] of legacySettingKeys) {
        migrate.run(currentKey, legacyKey)
        remove.run(legacyKey)
      }
    })()
  }

  private values(): Partial<TuneFlow.AppSetting> {
    const rows = getDB().prepare('SELECT key, value FROM web_settings').all() as Array<{ key: string, value: string }>
    const values: Partial<TuneFlow.AppSetting> = {}
    for (const { key, value } of rows) Object.assign(values, { [key]: JSON.parse(value) })
    return values
  }

  getSettings(): TuneFlow.AppSetting {
    return {
      ...defaultSetting,
      ...this.values(),
      ...serviceDefaults,
      'download.savePath': getAudioRoot(this.storageRoot),
    }
  }

  updateSettings(values: Record<string, unknown>): TuneFlow.AppSetting {
    if (Object.prototype.hasOwnProperty.call(values, 'download.savePath')) {
      throw new ApiError(400, 'IMMUTABLE_SETTING', 'Download path is managed by the Service')
    }
    const allowedKeys = new Set(Object.keys(defaultSetting))
    const upsert = getDB().prepare('INSERT INTO web_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    const db = getDB()
    db.transaction((patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        if (!allowedKeys.has(key)) throw new ApiError(400, 'INVALID_SETTING', `Unknown setting: ${key}`)
        if (key === 'download.maxDownloadNum' && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 6)) {
          throw new ApiError(400, 'INVALID_SETTING', 'Download concurrency must be an integer from 1 to 6')
        }
        if (key === 'download.fileName' && !['歌名 - 歌手', '歌手 - 歌名', '歌名'].includes(String(value))) {
          throw new ApiError(400, 'INVALID_SETTING', 'Download filename pattern is invalid')
        }
        upsert.run(key, JSON.stringify(value))
      }
    })(values)
    return this.getSettings()
  }
}
