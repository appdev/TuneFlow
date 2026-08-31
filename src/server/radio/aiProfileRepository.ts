import { getDB } from '../db/core/db'
import type { AIProfile } from './types'

export interface StoredAIProfile {
  profileId: string
  generatedAt: number
  expiresAt: number
  provider: string
  model: string
  promptVersion: string
  inputHistoryCutoff: number
  inputFingerprint: string
  profile: AIProfile
}

interface ProfileRow {
  profileId: string
  generatedAt: number
  expiresAt: number
  provider: string
  model: string
  promptVersion: string
  inputHistoryCutoff: number
  inputFingerprint: string
  profileJson: string
}

const rowProfile = (row: ProfileRow): StoredAIProfile => ({ ...row, profile: JSON.parse(row.profileJson) as AIProfile })

export class AIProfileRepository {
  constructor() {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS recommendation_ai_profile (
        profile_id TEXT PRIMARY KEY,
        generated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        input_history_cutoff INTEGER NOT NULL,
        input_fingerprint TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS recommendation_ai_profile_generated ON recommendation_ai_profile(generated_at DESC);
      CREATE TABLE IF NOT EXISTS recommendation_ai_run (
        run_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        latency_ms INTEGER NOT NULL,
        token_usage_json TEXT
      );
    `)
  }

  latest(options: { provider: string, model: string, promptVersion: string, minimumGeneratedAt: number }): StoredAIProfile | null {
    const row = getDB().prepare(`SELECT profile_id AS profileId, generated_at AS generatedAt, expires_at AS expiresAt,
      provider, model, prompt_version AS promptVersion, input_history_cutoff AS inputHistoryCutoff,
      input_fingerprint AS inputFingerprint, profile_json AS profileJson
      FROM recommendation_ai_profile
      WHERE status='complete' AND provider=? AND model=? AND prompt_version=? AND generated_at>=?
      ORDER BY generated_at DESC LIMIT 1`).get(options.provider, options.model, options.promptVersion, options.minimumGeneratedAt) as ProfileRow | undefined
    return row == null ? null : rowProfile(row)
  }

  saveComplete(profile: StoredAIProfile): void {
    getDB().prepare(`INSERT INTO recommendation_ai_profile(
      profile_id, generated_at, expires_at, provider, model, prompt_version,
      input_history_cutoff, input_fingerprint, profile_json, status, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', NULL)`)
      .run(profile.profileId, profile.generatedAt, profile.expiresAt, profile.provider, profile.model, profile.promptVersion, profile.inputHistoryCutoff, profile.inputFingerprint, JSON.stringify(profile.profile))
  }

  endedPlaybackCountSince(cutoff: number): number {
    const row = getDB().prepare('SELECT COUNT(*) AS count FROM web_playback_history WHERE ended_at IS NOT NULL AND ended_at>?').get(cutoff) as { count: number } | undefined
    return row?.count ?? 0
  }

  recordRun(input: {
    runId: string
    purpose: 'profile' | 'rerank' | 'connection_test'
    startedAt: number
    finishedAt: number
    provider: string
    model: string
    inputFingerprint: string
    candidateCount: number
    status: 'complete' | 'failed'
    errorCode: string | null
    tokenUsage?: Record<string, number> | null
  }): void {
    getDB().prepare(`INSERT INTO recommendation_ai_run(
      run_id, purpose, started_at, finished_at, provider, model, input_fingerprint,
      candidate_count, status, error_code, latency_ms, token_usage_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.runId, input.purpose, input.startedAt, input.finishedAt, input.provider, input.model, input.inputFingerprint, input.candidateCount, input.status, input.errorCode, Math.max(0, input.finishedAt - input.startedAt), input.tokenUsage == null ? null : JSON.stringify(input.tokenUsage))
  }

  latestRun(purpose: 'profile' | 'rerank' | 'connection_test'): { errorCode: string | null, finishedAt: number, status: string } | null {
    return (getDB().prepare(`SELECT error_code AS errorCode, finished_at AS finishedAt, status
      FROM recommendation_ai_run WHERE purpose=? ORDER BY finished_at DESC LIMIT 1`).get(purpose) as { errorCode: string | null, finishedAt: number, status: string } | undefined) ?? null
  }

  clear(): number {
    return getDB().transaction(() => getDB().prepare('DELETE FROM recommendation_ai_profile').run().changes + getDB().prepare('DELETE FROM recommendation_ai_run').run().changes)()
  }
}
