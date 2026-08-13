import { getDB } from '../db/core/db'

export type PlaybackHistoryTrack = Record<string, unknown> & {
  id: string
  source: string
}

export interface PlaybackHistoryEntry {
  track: PlaybackHistoryTrack
  playedAt: number
}

interface PlaybackHistoryRow {
  trackJson: string
  playedAt: number
}

export class PlaybackHistoryRepository {
  constructor(private readonly now: () => number = Date.now) {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS web_playback_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        track_json TEXT NOT NULL,
        played_at INTEGER NOT NULL,
        UNIQUE(source, track_id)
      );
      CREATE INDEX IF NOT EXISTS index_web_playback_history_order
      ON web_playback_history(played_at DESC, sequence DESC);
    `)
  }

  record(track: PlaybackHistoryTrack): PlaybackHistoryEntry {
    const playedAt = this.now()
    const db = getDB()
    db.transaction(() => {
      db.prepare('DELETE FROM web_playback_history WHERE source=? AND track_id=?').run(track.source, track.id)
      db.prepare('INSERT INTO web_playback_history(source, track_id, track_json, played_at) VALUES (?, ?, ?, ?)')
        .run(track.source, track.id, JSON.stringify(track), playedAt)
      db.prepare(`
        DELETE FROM web_playback_history
        WHERE sequence NOT IN (
          SELECT sequence
          FROM web_playback_history
          ORDER BY played_at DESC, sequence DESC
          LIMIT 50
        )
      `).run()
    })()
    return { track, playedAt }
  }

  list(): PlaybackHistoryEntry[] {
    const rows = getDB().prepare(`
      SELECT track_json AS trackJson, played_at AS playedAt
      FROM web_playback_history
      ORDER BY played_at DESC, sequence DESC
      LIMIT 50
    `).all() as PlaybackHistoryRow[]
    return rows.map(row => ({
      track: JSON.parse(row.trackJson) as PlaybackHistoryTrack,
      playedAt: row.playedAt,
    }))
  }
}
