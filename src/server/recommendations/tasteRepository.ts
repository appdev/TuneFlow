import { randomUUID } from 'node:crypto'
import { LIST_IDS, SPLIT_CHAR } from '../../common/constants'
import { getDB } from '../db/core/db'
import type { PlaybackSession } from '../playback/historyRepository'
import { canonicalizeTrack, normalizeArtistIdentity, normalizeLabel } from './identity'
import { recommendationPolicy } from './policy'
import type { RecommendationFeedbackInput, RecommendationFeedbackState, RecommendationTrack } from './types'

export interface TasteFact {
  canonicalTrackId: string
  score: number
  playCount: number
  completedCount: number
  earlySkipCount: number
  lastPlayedAt: number | null
}

export interface TasteExclusions {
  tracks: Set<string>
  artists: Set<string>
  titles: Set<string>
  trackPatterns: Set<string>
}

interface TasteRow {
  canonicalTrackId: string
  score: number
  playCount: number
  completedCount: number
  earlySkipCount: number
  lastPlayedAt: number | null
  updatedAt: number
}

const DAY_MS = 86_400_000
const TRACK_PATTERN_SEPARATOR = '\u001f'
const excludedListIds = new Set<string>([LIST_IDS.DEFAULT, LIST_IDS.TEMP, LIST_IDS.DOWNLOAD, LIST_IDS.LOCAL])

const trackPatternKey = (title: string, artists: readonly string[]): string => [title, ...artists].join(TRACK_PATTERN_SEPARATOR)

export interface PlaybackSignalClassification {
  delta: number
  earlySkip: boolean
  accepted: boolean
  ratio: number
}

export const classifyPlaybackSignal = (session: PlaybackSession): PlaybackSignalClassification => {
  const policy = recommendationPolicy.playbackSignals
  const duration = Math.max(0, session.durationSeconds ?? 0)
  const position = Math.max(0, session.lastPositionSeconds ?? 0)
  const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0
  const earlySkip = !session.completed && position < policy.earlySkipMaxPositionSeconds && ratio < policy.earlySkipMaxRatio
  const accepted = session.completed || ratio >= 0.5
  if (session.completed) return { delta: policy.completed, earlySkip: false, accepted, ratio }
  if (earlySkip) return { delta: policy.earlySkip, earlySkip: true, accepted, ratio }
  if (ratio >= 0.8) return { delta: policy.listenedAtLeast80Percent, earlySkip: false, accepted, ratio }
  if (ratio >= 0.5) return { delta: policy.listenedAtLeast50Percent, earlySkip: false, accepted, ratio }
  if (ratio >= 0.25) return { delta: policy.partialListen, earlySkip: false, accepted, ratio }
  return { delta: policy.lowCompletion, earlySkip: false, accepted, ratio }
}

const clampScore = (score: number, maximum: number): number => Math.max(-maximum, Math.min(maximum, score))

export class TasteRepository {
  constructor(private readonly now: () => number = Date.now, private readonly createId: () => string = randomUUID) {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS recommendation_taste_track (
        canonical_id TEXT PRIMARY KEY,
        score REAL NOT NULL,
        play_count INTEGER NOT NULL,
        completed_count INTEGER NOT NULL,
        early_skip_count INTEGER NOT NULL,
        last_played_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendation_taste_artist (
        artist TEXT PRIMARY KEY,
        score REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendation_processed_playback (
        playback_id TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendation_feedback (
        feedback_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        track_json TEXT,
        active INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recommendation_feedback_target ON recommendation_feedback(kind, target, active);
    `)
  }

  applyPlayback(session: PlaybackSession): boolean {
    if (session.endedAt == null) return false
    const canonical = canonicalizeTrack(session.track)
    if (canonical == null) return false
    return getDB().transaction(() => {
      if (getDB().prepare('SELECT 1 FROM recommendation_processed_playback WHERE playback_id=?').get(session.playbackId) != null) return false
      const { delta, earlySkip } = classifyPlaybackSignal(session)
      const now = session.endedAt
      const previous = getDB().prepare('SELECT score FROM recommendation_taste_track WHERE canonical_id=?')
        .get(canonical.canonicalTrackId) as { score: number } | undefined
      const trackScore = clampScore((previous?.score ?? 0) + delta, recommendationPolicy.playbackSignals.maxImplicitTrackScore)
      getDB().prepare(`
        INSERT INTO recommendation_taste_track(canonical_id, score, play_count, completed_count, early_skip_count, last_played_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(canonical_id) DO UPDATE SET score=excluded.score,
          play_count=recommendation_taste_track.play_count+1, completed_count=recommendation_taste_track.completed_count+excluded.completed_count,
          early_skip_count=recommendation_taste_track.early_skip_count+excluded.early_skip_count, last_played_at=excluded.last_played_at, updated_at=excluded.updated_at
      `).run(canonical.canonicalTrackId, trackScore, session.completed ? 1 : 0, earlySkip ? 1 : 0, now, now)
      const upsertArtist = getDB().prepare(`INSERT INTO recommendation_taste_artist(artist, score, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(artist) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`)
      const readArtist = getDB().prepare('SELECT score FROM recommendation_taste_artist WHERE artist=?')
      for (const artist of canonical.normalizedArtists) {
        const artistRow = readArtist.get(artist) as { score: number } | undefined
        const artistScore = clampScore((artistRow?.score ?? 0) + delta, recommendationPolicy.playbackSignals.maxImplicitArtistScore)
        upsertArtist.run(artist, artistScore, now)
      }
      getDB().prepare('INSERT INTO recommendation_processed_playback(playback_id, processed_at) VALUES (?, ?)').run(session.playbackId, now)
      return true
    })()
  }

  syncExplicitFacts(): void {
    const now = this.now()
    const rows = getDB().prepare('SELECT id, listId, name, singer, source, interval, meta FROM my_list_music_info')
      .all() as Array<{ id: string, listId: string, name: string, singer: string, source: string, interval: string | null, meta: string }>
    getDB().transaction(() => {
      getDB().prepare("DELETE FROM recommendation_feedback WHERE kind IN ('library_track','download_track')").run()
      const insert = getDB().prepare(`INSERT INTO recommendation_feedback(feedback_id, kind, target, track_json, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`)
      for (const row of rows) {
        if (excludedListIds.has(row.listId)) continue
        const track: RecommendationTrack = { id: row.id, source: row.source, name: row.name, singer: row.singer, interval: row.interval, meta: JSON.parse(row.meta) }
        const canonical = canonicalizeTrack(track)
        if (canonical == null) continue
        const weight = row.listId === LIST_IDS.LOVE ? 4 : 2
        insert.run(`library:${row.listId}:${row.source}:${row.id}`, 'library_track', canonical.canonicalTrackId, JSON.stringify({ track, weight }), now, now)
      }
      if (this.tableExists('web_downloads')) {
        const downloads = getDB().prepare("SELECT id, record FROM web_downloads WHERE status='completed'").all() as Array<{ id: string, record: string }>
        for (const row of downloads) {
          const record = JSON.parse(row.record) as { musicInfo?: RecommendationTrack }
          if (record.musicInfo == null) continue
          const canonical = canonicalizeTrack(record.musicInfo)
          if (canonical == null) continue
          insert.run(`download:${row.id}`, 'download_track', canonical.canonicalTrackId, JSON.stringify({ track: record.musicInfo, weight: 3 }), now, now)
        }
      }
    })()
  }

  recordFeedback(input: RecommendationFeedbackInput): RecommendationFeedbackState {
    const now = this.now()
    if (input.type === 'undo') {
      const result = getDB().prepare("UPDATE recommendation_feedback SET active=0, updated_at=? WHERE feedback_id=? AND kind IN ('not_interested_track','not_interested_artist')")
        .run(now, input.feedbackId)
      return { feedbackId: input.feedbackId, active: false, type: 'undo', ...(result.changes === 0 ? {} : {}) }
    }
    const target = input.type === 'not_interested_track'
      ? canonicalizeTrack(input.track)?.canonicalTrackId
      : normalizeLabel(input.artist)
    if (target == null || target === '') throw new Error('INVALID_RECOMMENDATION_FEEDBACK')
    const existing = getDB().prepare('SELECT feedback_id AS feedbackId FROM recommendation_feedback WHERE kind=? AND target=? AND active=1')
      .get(input.type, target) as { feedbackId: string } | undefined
    if (existing != null) return { feedbackId: existing.feedbackId, active: true, type: input.type }
    const feedbackId = this.createId()
    getDB().prepare(`INSERT INTO recommendation_feedback(feedback_id, kind, target, track_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`).run(feedbackId, input.type, target, input.type === 'not_interested_track' ? JSON.stringify(input.track) : null, now, now)
    return { feedbackId, active: true, type: input.type }
  }

  facts(): Map<string, TasteFact> {
    const now = this.now()
    const rows = getDB().prepare(`SELECT canonical_id AS canonicalTrackId, score, play_count AS playCount,
      completed_count AS completedCount, early_skip_count AS earlySkipCount, last_played_at AS lastPlayedAt, updated_at AS updatedAt
      FROM recommendation_taste_track`).all() as TasteRow[]
    const explicit = getDB().prepare("SELECT target, track_json AS trackJson FROM recommendation_feedback WHERE kind IN ('library_track','download_track') AND active=1")
      .all() as Array<{ target: string, trackJson: string }>
    const result = new Map<string, TasteFact>()
    for (const row of rows) {
      const decay = Math.pow(0.5, Math.max(0, now - row.updatedAt) / (recommendationPolicy.implicitHalfLifeDays * DAY_MS))
      result.set(row.canonicalTrackId, { ...row, score: row.score * decay })
    }
    for (const item of explicit) {
      const weight = Number((JSON.parse(item.trackJson) as { weight?: number }).weight ?? 2)
      const current = result.get(item.target) ?? { canonicalTrackId: item.target, score: 0, playCount: 0, completedCount: 0, earlySkipCount: 0, lastPlayedAt: null }
      result.set(item.target, { ...current, score: current.score + weight })
    }
    return result
  }

  artistScores(): Map<string, number> {
    const now = this.now()
    const rows = getDB().prepare('SELECT artist, score, updated_at AS updatedAt FROM recommendation_taste_artist').all() as Array<{ artist: string, score: number, updatedAt: number }>
    return new Map(rows.map(row => [row.artist, row.score * Math.pow(0.5, Math.max(0, now - row.updatedAt) / (recommendationPolicy.implicitHalfLifeDays * DAY_MS))]))
  }

  exclusions(): TasteExclusions {
    const tracks = new Set<string>()
    const artists = new Set<string>()
    const titles = new Set<string>()
    const trackPatterns = new Set<string>()
    const rows = getDB().prepare("SELECT kind, target FROM recommendation_feedback WHERE active=1 AND kind IN ('not_interested_track','not_interested_artist')")
      .all() as Array<{ kind: string, target: string }>
    for (const row of rows) (row.kind === 'not_interested_track' ? tracks : artists).add(row.target)
    const legacy = getDB().prepare('SELECT content FROM dislike_list').all() as Array<{ content: string }>
    for (const row of legacy) {
      const [name, singer] = row.content.split(SPLIT_CHAR.DISLIKE_NAME)
      this.addLegacyExclusion(name, singer, titles, artists, trackPatterns)
    }
    if (this.tableExists('web_app_data')) {
      const stored = getDB().prepare("SELECT value FROM web_app_data WHERE key='web.dislike.rules'").get() as { value: string } | undefined
      if (stored != null) {
        const rules = JSON.parse(stored.value) as unknown
        if (typeof rules === 'string') {
          for (const rule of rules.split('\n')) {
            const [name, singer] = rule.split(SPLIT_CHAR.DISLIKE_NAME)
            this.addLegacyExclusion(name, singer, titles, artists, trackPatterns)
          }
        }
      }
    }
    return { tracks, artists, titles, trackPatterns }
  }

  clearProfile(): { profile: number, feedback: number } {
    return getDB().transaction(() => {
      const profile = getDB().prepare('DELETE FROM recommendation_taste_track').run().changes +
        getDB().prepare('DELETE FROM recommendation_taste_artist').run().changes +
        getDB().prepare('DELETE FROM recommendation_processed_playback').run().changes
      const feedback = getDB().prepare('DELETE FROM recommendation_feedback').run().changes
      return { profile, feedback }
    })()
  }

  private tableExists(name: string): boolean {
    return getDB().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) != null
  }

  private addLegacyExclusion(name: string | undefined, singer: string | undefined, titles: Set<string>, artists: Set<string>, trackPatterns: Set<string>): void {
    const title = normalizeLabel(name ?? '')
    const normalizedArtists = normalizeArtistIdentity(singer ?? '')
    if (title !== '' && normalizedArtists.length > 0) {
      trackPatterns.add(trackPatternKey(title, normalizedArtists))
    } else if (title !== '') {
      titles.add(title)
    } else {
      for (const artist of normalizedArtists) artists.add(artist)
    }
  }
}

export const toTasteTrackPattern = (title: string, artists: readonly string[]): string => trackPatternKey(title, artists)
