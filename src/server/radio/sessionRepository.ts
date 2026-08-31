import { createHash, randomUUID } from 'node:crypto'
import { getDB } from '../db/core/db'
import type { PlaybackSession } from '../playback/historyRepository'
import type { PlaybackSignalClassification } from '../recommendations/tasteRepository'
import type { RecommendationTrack } from '../recommendations/types'
import { radioPolicy } from './policy'
import type { RadioBatchRequest, RadioBatchResponse, RadioItem, RadioMode, RadioSession, RadioSessionItem } from './types'

interface SessionRow {
  sessionId: string
  mode: RadioMode
  status: RadioSession['status']
  startedAt: number
  lastActiveAt: number
  endedAt: number | null
  initialTrackJson: string | null
  profileId: string | null
  policyVersion: string
}

const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const toSession = (row: SessionRow): RadioSession => ({ ...row, initialTrack: row.initialTrackJson == null ? null : JSON.parse(row.initialTrackJson) as RecommendationTrack })

export class RadioSessionRepository {
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: { now?: () => number, createId?: () => string } = {}) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS radio_session (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        ended_at INTEGER,
        initial_track_json TEXT,
        profile_id TEXT,
        policy_version TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS radio_session_activity ON radio_session(last_active_at);
      CREATE TABLE IF NOT EXISTS radio_session_item (
        session_id TEXT NOT NULL REFERENCES radio_session(session_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        recommendation_item_id TEXT NOT NULL UNIQUE,
        canonical_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        state TEXT NOT NULL,
        ranking_source TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        completion_ratio REAL,
        PRIMARY KEY(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS radio_session_item_canonical ON radio_session_item(session_id, canonical_id);
      CREATE TABLE IF NOT EXISTS radio_session_request (
        session_id TEXT NOT NULL REFERENCES radio_session(session_id) ON DELETE CASCADE,
        queue_generation INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, queue_generation, request_id)
      );
      CREATE TABLE IF NOT EXISTS radio_playback_effect (
        playback_id TEXT PRIMARY KEY,
        recommendation_item_id TEXT NOT NULL REFERENCES radio_session_item(recommendation_item_id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        completed INTEGER,
        accepted INTEGER,
        early_skip INTEGER,
        ratio REAL
      );
    `)
    this.cleanup()
  }

  create(input: { mode: RadioMode, initialTrack: RecommendationTrack | null, profileId: string | null, policyVersion: string }): RadioSession {
    const now = this.now()
    const sessionId = this.createId()
    getDB().prepare(`INSERT INTO radio_session(session_id, mode, status, started_at, last_active_at, initial_track_json, profile_id, policy_version)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`)
      .run(sessionId, input.mode, now, now, input.initialTrack == null ? null : JSON.stringify(input.initialTrack), input.profileId, input.policyVersion)
    return this.getActive(sessionId)!
  }

  getActive(sessionId: string): RadioSession | null {
    this.expireIdle()
    const row = getDB().prepare(`SELECT session_id AS sessionId, mode, status, started_at AS startedAt, last_active_at AS lastActiveAt,
      ended_at AS endedAt, initial_track_json AS initialTrackJson, profile_id AS profileId, policy_version AS policyVersion
      FROM radio_session WHERE session_id=? AND status='active'`).get(sessionId) as SessionRow | undefined
    return row == null ? null : toSession(row)
  }

  recentItems(sessionId: string, limit = 20): RadioSessionItem[] {
    const rows = getDB().prepare(`SELECT session_id AS sessionId, sequence, recommendation_item_id AS recommendationItemId,
      canonical_id AS canonicalTrackId, item_json AS itemJson, state, ranking_source AS rankingSource,
      generated_at AS generatedAt, started_at AS startedAt, ended_at AS endedAt, completion_ratio AS completionRatio
      FROM radio_session_item WHERE session_id=? ORDER BY sequence DESC LIMIT ?`).all(sessionId, limit) as Array<Omit<RadioSessionItem, 'track' | 'reason'> & { itemJson: string }>
    return rows.reverse().map(({ itemJson, ...row }) => {
      const item = JSON.parse(itemJson) as RadioItem
      return { ...row, track: item.track, reason: item.reason }
    })
  }

  exposedCanonicalIds(sessionId: string): Set<string> {
    const rows = getDB().prepare('SELECT canonical_id AS canonicalId FROM radio_session_item WHERE session_id=?').all(sessionId) as Array<{ canonicalId: string }>
    return new Set(rows.map(row => row.canonicalId))
  }

  findBatch(sessionId: string, request: RadioBatchRequest): RadioBatchResponse | null {
    const row = getDB().prepare(`SELECT request_fingerprint AS requestFingerprint, response_json AS responseJson
      FROM radio_session_request WHERE session_id=? AND queue_generation=? AND request_id=?`)
      .get(sessionId, request.queueGeneration, request.requestId) as { requestFingerprint: string, responseJson: string } | undefined
    if (row == null) return null
    if (row.requestFingerprint !== fingerprint(request)) throw Object.assign(new Error('RADIO_REQUEST_CONFLICT'), { code: 'RADIO_REQUEST_CONFLICT' })
    return JSON.parse(row.responseJson) as RadioBatchResponse
  }

  latestBatch(sessionId: string): RadioBatchResponse | null {
    const row = getDB().prepare(`SELECT response_json AS responseJson FROM radio_session_request
      WHERE session_id=? ORDER BY created_at DESC, queue_generation DESC LIMIT 1`)
      .get(sessionId) as { responseJson: string } | undefined
    return row == null ? null : JSON.parse(row.responseJson) as RadioBatchResponse
  }

  publishBatch(response: RadioBatchResponse, request: RadioBatchRequest): RadioBatchResponse {
    return getDB().transaction(() => {
      const existing = this.findBatch(response.sessionId, request)
      if (existing != null) return existing
      const active = this.getActive(response.sessionId)
      if (active == null) throw Object.assign(new Error('RADIO_SESSION_NOT_ACTIVE'), { code: 'RADIO_SESSION_NOT_ACTIVE' })
      const row = getDB().prepare('SELECT COALESCE(MAX(sequence), -1) AS sequence FROM radio_session_item WHERE session_id=?').get(response.sessionId) as { sequence: number }
      let sequence = row.sequence + 1
      const now = this.now()
      const insert = getDB().prepare(`INSERT INTO radio_session_item(
        session_id, sequence, recommendation_item_id, canonical_id, item_json, state, ranking_source, generated_at
      ) VALUES (?, ?, ?, ?, ?, 'offered', ?, ?)`)
      for (const item of response.items) insert.run(response.sessionId, sequence++, item.recommendationItemId, item.canonicalTrackId, JSON.stringify(item), item.rankingSource, now)
      getDB().prepare(`INSERT INTO radio_session_request(session_id, queue_generation, request_id, request_fingerprint, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(response.sessionId, request.queueGeneration, request.requestId, fingerprint(request), JSON.stringify(response), now)
      getDB().prepare('UPDATE radio_session SET last_active_at=? WHERE session_id=?').run(now, response.sessionId)
      return response
    })()
  }

  recordResolve(recommendationItemId: string, outcome: 'resolved' | 'unplayable'): boolean {
    const next = outcome === 'resolved' ? 'queued' : 'unplayable'
    const result = getDB().prepare("UPDATE radio_session_item SET state=? WHERE recommendation_item_id=? AND state='offered'").run(next, recommendationItemId)
    return result.changes > 0
  }

  recordPlaybackStart(session: PlaybackSession): boolean {
    if (session.recommendationItemId == null) return false
    return getDB().transaction(() => {
      const inserted = getDB().prepare(`INSERT INTO radio_playback_effect(playback_id, recommendation_item_id, started_at)
        SELECT ?, recommendation_item_id, ? FROM radio_session_item WHERE recommendation_item_id=? ON CONFLICT(playback_id) DO NOTHING`)
        .run(session.playbackId, session.startedAt, session.recommendationItemId)
      if (inserted.changes === 0) return false
      getDB().prepare("UPDATE radio_session_item SET state='started', started_at=? WHERE recommendation_item_id=? AND state IN ('offered','queued')")
        .run(session.startedAt, session.recommendationItemId)
      return true
    })()
  }

  recordPlaybackEnd(session: PlaybackSession, signal: PlaybackSignalClassification): boolean {
    if (session.recommendationItemId == null || session.endedAt == null) return false
    return getDB().transaction(() => {
      this.recordPlaybackStart(session)
      const updated = getDB().prepare(`UPDATE radio_playback_effect SET ended_at=?, completed=?, accepted=?, early_skip=?, ratio=?
        WHERE playback_id=? AND recommendation_item_id=? AND ended_at IS NULL`)
        .run(session.endedAt, session.completed ? 1 : 0, signal.accepted ? 1 : 0, signal.earlySkip ? 1 : 0, signal.ratio, session.playbackId, session.recommendationItemId)
      if (updated.changes === 0) return false
      getDB().prepare('UPDATE radio_session_item SET state=?, ended_at=?, completion_ratio=? WHERE recommendation_item_id=?')
        .run(session.completed ? 'completed' : 'skipped', session.endedAt, signal.ratio, session.recommendationItemId)
      return true
    })()
  }

  close(sessionId: string): boolean {
    const now = this.now()
    return getDB().prepare("UPDATE radio_session SET status='closed', ended_at=?, last_active_at=? WHERE session_id=? AND status='active'").run(now, now, sessionId).changes > 0
  }

  clear(): number {
    return getDB().prepare('DELETE FROM radio_session').run().changes
  }

  private expireIdle(): void {
    const now = this.now()
    getDB().prepare("UPDATE radio_session SET status='expired', ended_at=? WHERE status='active' AND last_active_at<=?").run(now, now - radioPolicy.sessionIdleMs)
  }

  private cleanup(): void {
    const now = this.now()
    getDB().transaction(() => {
      this.expireIdle()
      getDB().prepare("DELETE FROM radio_session WHERE status!='active' AND COALESCE(ended_at, last_active_at)<?").run(now - radioPolicy.retentionMs)
    })()
  }
}
