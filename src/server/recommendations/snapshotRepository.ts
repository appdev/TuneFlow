import { randomUUID } from 'node:crypto'
import { getDB } from '../db/core/db'
import { recommendationPolicy } from './policy'
import type { DailyRecommendationResponse, RankedRecommendation, RecommendationItem, RecommendationStatus } from './types'
import type { PlaybackSession } from '../playback/historyRepository'
import type { PlaybackSignalClassification } from './tasteRepository'

interface SnapshotRow {
  id: string
  localDate: string
  version: number
  status: RecommendationStatus
  generatedAt: number
  sourceCoverageJson: string
}

export class SnapshotRepository {
  constructor(private readonly now: () => number = Date.now, private readonly createId: () => string = randomUUID) {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS recommendation_snapshot (
        snapshot_id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        source_coverage_json TEXT NOT NULL,
        UNIQUE(local_date, version)
      );
      CREATE TABLE IF NOT EXISTS recommendation_snapshot_item (
        snapshot_id TEXT NOT NULL REFERENCES recommendation_snapshot(snapshot_id) ON DELETE CASCADE,
        recommendation_item_id TEXT NOT NULL UNIQUE,
        canonical_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        item_json TEXT NOT NULL,
        resolve_outcome TEXT,
        playback_started_count INTEGER NOT NULL DEFAULT 0,
        playback_completed_count INTEGER NOT NULL DEFAULT 0,
        playback_accepted_count INTEGER NOT NULL DEFAULT 0,
        playback_early_skip_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(snapshot_id, position)
      );
      CREATE TABLE IF NOT EXISTS recommendation_current_snapshot (
        local_date TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL REFERENCES recommendation_snapshot(snapshot_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS recommendation_exposure (
        local_date TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        first_exposed_at INTEGER NOT NULL,
        exposure_count INTEGER NOT NULL,
        PRIMARY KEY(local_date, canonical_id)
      );
      CREATE TABLE IF NOT EXISTS recommendation_job (
        generation_id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS recommendation_playback_effect (
        playback_id TEXT PRIMARY KEY,
        recommendation_item_id TEXT NOT NULL REFERENCES recommendation_snapshot_item(recommendation_item_id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        completed INTEGER,
        accepted INTEGER,
        early_skip INTEGER,
        ratio REAL
      );
      CREATE INDEX IF NOT EXISTS recommendation_playback_effect_item ON recommendation_playback_effect(recommendation_item_id);
    `)
    this.ensureItemMetricsSchema()
    this.cleanup()
  }

  current(localDate: string): DailyRecommendationResponse | null {
    const row = getDB().prepare(`SELECT s.snapshot_id AS id, s.local_date AS localDate, s.version, s.status,
      s.generated_at AS generatedAt, s.source_coverage_json AS sourceCoverageJson FROM recommendation_current_snapshot c
      JOIN recommendation_snapshot s ON s.snapshot_id=c.snapshot_id WHERE c.local_date=?`).get(localDate) as SnapshotRow | undefined
    if (row == null) return null
    const items = getDB().prepare('SELECT item_json AS itemJson FROM recommendation_snapshot_item WHERE snapshot_id=? ORDER BY position')
      .all(row.id) as Array<{ itemJson: string }>
    return { status: row.status, localDate: row.localDate, version: row.version, generatedAt: row.generatedAt, sourceCoverage: JSON.parse(row.sourceCoverageJson) as string[], items: items.map(item => JSON.parse(item.itemJson) as RecommendationItem) }
  }

  publish(localDate: string, status: Extract<RecommendationStatus, 'ready' | 'degraded'>, coverage: string[], ranked: RankedRecommendation[]): DailyRecommendationResponse {
    const now = this.now()
    return getDB().transaction(() => {
      const version = Number((getDB().prepare('SELECT MAX(version) AS version FROM recommendation_snapshot WHERE local_date=?').get(localDate) as { version: number | null }).version ?? 0) + 1
      const snapshotId = this.createId()
      getDB().prepare('INSERT INTO recommendation_snapshot(snapshot_id, local_date, version, status, generated_at, source_coverage_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(snapshotId, localDate, version, status, now, JSON.stringify(coverage))
      const insert = getDB().prepare('INSERT INTO recommendation_snapshot_item(snapshot_id, recommendation_item_id, canonical_id, position, item_json) VALUES (?, ?, ?, ?, ?)')
      const expose = getDB().prepare(`INSERT INTO recommendation_exposure(local_date, canonical_id, first_exposed_at, exposure_count) VALUES (?, ?, ?, 1)
        ON CONFLICT(local_date, canonical_id) DO UPDATE SET exposure_count=recommendation_exposure.exposure_count+1`)
      const items = ranked.map((rank, position): RecommendationItem => {
        const item = { recommendationItemId: this.createId(), canonicalTrackId: rank.canonicalTrackId, track: rank.variant.track, bucket: rank.bucket, reason: rank.reason }
        insert.run(snapshotId, item.recommendationItemId, rank.canonicalTrackId, position, JSON.stringify(item))
        expose.run(localDate, rank.canonicalTrackId, now)
        return item
      })
      getDB().prepare(`INSERT INTO recommendation_current_snapshot(local_date, snapshot_id) VALUES (?, ?)
        ON CONFLICT(local_date) DO UPDATE SET snapshot_id=excluded.snapshot_id`).run(localDate, snapshotId)
      return { status, localDate, version, generatedAt: now, sourceCoverage: coverage, items }
    })()
  }

  exposedToday(localDate: string): Set<string> {
    const rows = getDB().prepare('SELECT canonical_id AS canonicalId FROM recommendation_exposure WHERE local_date=?').all(localDate) as Array<{ canonicalId: string }>
    return new Set(rows.map(row => row.canonicalId))
  }

  startJob(localDate: string, generationId: string): void {
    getDB().prepare("INSERT INTO recommendation_job(generation_id, local_date, status, started_at) VALUES (?, ?, 'generating', ?)").run(generationId, localDate, this.now())
  }

  finishJob(generationId: string, status: 'ready' | 'degraded' | 'failed', errorCode: string | null): void {
    getDB().prepare('UPDATE recommendation_job SET status=?, error_code=?, ended_at=? WHERE generation_id=?').run(status, errorCode, this.now(), generationId)
  }

  lastJob(localDate: string): { generationId: string, status: string, errorCode: string | null } | null {
    return (getDB().prepare('SELECT generation_id AS generationId, status, error_code AS errorCode FROM recommendation_job WHERE local_date=? ORDER BY started_at DESC LIMIT 1')
      .get(localDate) as { generationId: string, status: string, errorCode: string | null } | undefined) ?? null
  }

  recordResolve(recommendationItemId: string, outcome: 'resolved' | 'unplayable'): void {
    getDB().prepare('UPDATE recommendation_snapshot_item SET resolve_outcome=? WHERE recommendation_item_id=?').run(outcome, recommendationItemId)
  }

  recordPlaybackStart(session: PlaybackSession): boolean {
    if (session.recommendationItemId == null) return false
    return getDB().transaction(() => {
      const inserted = getDB().prepare(`
        INSERT INTO recommendation_playback_effect(playback_id, recommendation_item_id, started_at)
        SELECT ?, recommendation_item_id, ? FROM recommendation_snapshot_item WHERE recommendation_item_id=?
        ON CONFLICT(playback_id) DO NOTHING
      `).run(session.playbackId, session.startedAt, session.recommendationItemId)
      if (inserted.changes === 0) return false
      getDB().prepare('UPDATE recommendation_snapshot_item SET playback_started_count=playback_started_count+1 WHERE recommendation_item_id=?')
        .run(session.recommendationItemId)
      return true
    })()
  }

  recordPlaybackEnd(session: PlaybackSession, classification: PlaybackSignalClassification): boolean {
    if (session.recommendationItemId == null || session.endedAt == null) return false
    return getDB().transaction(() => {
      this.recordPlaybackStart(session)
      const updated = getDB().prepare(`
        UPDATE recommendation_playback_effect SET ended_at=?, completed=?, accepted=?, early_skip=?, ratio=?
        WHERE playback_id=? AND recommendation_item_id=? AND ended_at IS NULL
      `).run(session.endedAt, session.completed ? 1 : 0, classification.accepted ? 1 : 0, classification.earlySkip ? 1 : 0, classification.ratio, session.playbackId, session.recommendationItemId)
      if (updated.changes === 0) return false
      getDB().prepare(`
        UPDATE recommendation_snapshot_item SET
          playback_completed_count=playback_completed_count+?,
          playback_accepted_count=playback_accepted_count+?,
          playback_early_skip_count=playback_early_skip_count+?
        WHERE recommendation_item_id=?
      `).run(session.completed ? 1 : 0, classification.accepted ? 1 : 0, classification.earlySkip ? 1 : 0, session.recommendationItemId)
      return true
    })()
  }

  effectStats(recommendationItemId: string): { resolved: 'resolved' | 'unplayable' | null, started: number, completed: number, accepted: number, earlySkip: number } | null {
    return (getDB().prepare(`
      SELECT resolve_outcome AS resolved, playback_started_count AS started,
        playback_completed_count AS completed, playback_accepted_count AS accepted,
        playback_early_skip_count AS earlySkip
      FROM recommendation_snapshot_item WHERE recommendation_item_id=?
    `).get(recommendationItemId) as { resolved: 'resolved' | 'unplayable' | null, started: number, completed: number, accepted: number, earlySkip: number } | undefined) ?? null
  }

  clearProfileData(): { exposure: number, snapshots: number } {
    return getDB().transaction(() => {
      const exposure = getDB().prepare('DELETE FROM recommendation_exposure').run().changes
      getDB().prepare('DELETE FROM recommendation_current_snapshot').run()
      const snapshots = getDB().prepare('DELETE FROM recommendation_snapshot').run().changes
      getDB().prepare('DELETE FROM recommendation_job').run()
      return { exposure, snapshots }
    })()
  }

  private cleanup(): void {
    const cutoff = this.now() - recommendationPolicy.rawSnapshotRetentionDays * 86_400_000
    getDB().transaction(() => {
      getDB().prepare('DELETE FROM recommendation_current_snapshot WHERE snapshot_id IN (SELECT snapshot_id FROM recommendation_snapshot WHERE generated_at < ?)').run(cutoff)
      getDB().prepare('DELETE FROM recommendation_snapshot WHERE generated_at < ?').run(cutoff)
      getDB().prepare('DELETE FROM recommendation_job WHERE started_at < ?').run(cutoff)
    })()
  }

  private ensureItemMetricsSchema(): void {
    const columns = new Set((getDB().prepare('PRAGMA table_info(recommendation_snapshot_item)').all() as Array<{ name: string }>).map(row => row.name))
    const additions = [
      ['playback_started_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['playback_completed_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['playback_accepted_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['playback_early_skip_count', 'INTEGER NOT NULL DEFAULT 0'],
    ] as const
    for (const [name, definition] of additions) {
      if (!columns.has(name)) getDB().exec(`ALTER TABLE recommendation_snapshot_item ADD COLUMN ${name} ${definition}`)
    }
  }
}
