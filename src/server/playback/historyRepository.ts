import { randomUUID } from 'node:crypto'
import { getDB } from '../db/core/db'
import { sanitizePlaybackTrack, type PlaybackHistoryTrack } from './historyTrack'

export type { PlaybackHistoryTrack } from './historyTrack'

export const PLAYBACK_PLATFORMS = ['android', 'ios', 'macos', 'windows', 'linux', 'web', 'other'] as const
export type PlaybackPlatform = typeof PLAYBACK_PLATFORMS[number]

export interface PlaybackSessionEnd {
  completed: boolean
  lastPositionSeconds: number
  durationSeconds: number
}

export interface PlaybackSession {
  playbackId: string
  track: PlaybackHistoryTrack
  platform: PlaybackPlatform
  startedAt: number
  endedAt: number | null
  completed: boolean
  lastPositionSeconds: number | null
  durationSeconds: number | null
}

interface PlaybackSessionRow {
  playbackId: string
  trackJson: string
  platform: PlaybackPlatform
  startedAt: number
  endedAt: number | null
  completed: number
  lastPositionSeconds: number | null
  durationSeconds: number | null
}

interface PlaybackHistoryRepositoryOptions {
  now?: () => number
  createId?: () => string
}

const RETENTION_MS = 30 * 86_400_000
const schemaColumns = [
  'sequence',
  'playback_id',
  'source',
  'track_id',
  'track_json',
  'platform',
  'started_at',
  'ended_at',
  'completed',
  'last_position_seconds',
  'duration_seconds',
]

const createSchema = (): void => {
  getDB().exec(`
    CREATE TABLE web_playback_history (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      playback_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      track_id TEXT NOT NULL,
      track_json TEXT NOT NULL,
      platform TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      last_position_seconds REAL,
      duration_seconds REAL
    );
    CREATE INDEX index_web_playback_history_order
    ON web_playback_history(started_at DESC, sequence DESC);
  `)
}

const ensureSchema = (): void => {
  const db = getDB()
  const columns = (db.prepare('PRAGMA table_info(web_playback_history)').all() as Array<{ name: string }>).map(row => row.name)
  if (columns.length === 0) {
    createSchema()
    return
  }
  if (columns.join('\0') === schemaColumns.join('\0')) return
  db.transaction(() => {
    db.exec('DROP TABLE web_playback_history')
    createSchema()
  })()
}

const rowToSession = (row: PlaybackSessionRow): PlaybackSession => ({
  playbackId: row.playbackId,
  track: JSON.parse(row.trackJson) as PlaybackHistoryTrack,
  platform: row.platform,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  completed: row.completed === 1,
  lastPositionSeconds: row.lastPositionSeconds,
  durationSeconds: row.durationSeconds,
})

export class PlaybackHistoryRepository {
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: PlaybackHistoryRepositoryOptions = {}) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    ensureSchema()
    this.cleanup()
  }

  start(track: PlaybackHistoryTrack, platform: PlaybackPlatform): PlaybackSession {
    const playbackId = this.createId()
    const startedAt = this.now()
    const safeTrack = sanitizePlaybackTrack(track)
    return getDB().transaction(() => {
      this.cleanup(startedAt)
      getDB().prepare(`
        INSERT INTO web_playback_history(
          playback_id, source, track_id, track_json, platform, started_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(playbackId, safeTrack.source, safeTrack.id, JSON.stringify(safeTrack), platform, startedAt)
      return this.get(playbackId)!
    })()
  }

  end(playbackId: string, terminal: PlaybackSessionEnd): PlaybackSession | undefined {
    const endedAt = this.now()
    return getDB().transaction(() => {
      this.cleanup(endedAt)
      const current = this.get(playbackId)
      if (current == null || current.endedAt != null) return current
      getDB().prepare(`
        UPDATE web_playback_history
        SET ended_at=?, completed=?, last_position_seconds=?, duration_seconds=?
        WHERE playback_id=?
      `).run(endedAt, terminal.completed ? 1 : 0, terminal.lastPositionSeconds, terminal.durationSeconds, playbackId)
      return this.get(playbackId)
    })()
  }

  list(): PlaybackSession[] {
    this.cleanup()
    const rows = getDB().prepare(`
      SELECT playback_id AS playbackId, track_json AS trackJson, platform,
        started_at AS startedAt, ended_at AS endedAt, completed,
        last_position_seconds AS lastPositionSeconds, duration_seconds AS durationSeconds
      FROM web_playback_history
      ORDER BY started_at DESC, sequence DESC
    `).all() as PlaybackSessionRow[]
    return rows.map(rowToSession)
  }

  private get(playbackId: string): PlaybackSession | undefined {
    const row = getDB().prepare(`
      SELECT playback_id AS playbackId, track_json AS trackJson, platform,
        started_at AS startedAt, ended_at AS endedAt, completed,
        last_position_seconds AS lastPositionSeconds, duration_seconds AS durationSeconds
      FROM web_playback_history
      WHERE playback_id=?
    `).get(playbackId) as PlaybackSessionRow | undefined
    return row == null ? undefined : rowToSession(row)
  }

  private cleanup(now = this.now()): void {
    getDB().prepare('DELETE FROM web_playback_history WHERE started_at < ?').run(now - RETENTION_MS)
  }
}
