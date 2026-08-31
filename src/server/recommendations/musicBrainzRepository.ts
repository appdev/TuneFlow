import { createHash } from 'node:crypto'
import { getDB } from '../db/core/db'
import { canonicalizeTrack, normalizeLabel } from './identity'
import { MusicBrainzClient, MusicBrainzClientError, type MusicBrainzClientOptions } from './musicBrainzClient'
import { normalizeMusicBrainzBaseUrl } from './musicBrainzEndpoint'
import type {
  MusicBrainzConnectionTestResult,
  MusicBrainzRecording,
  MusicBrainzRecordingMatch,
  RecommendationTrack,
} from './types'

const DAY_MS = 86_400_000
const TTL = Object.freeze({ mapping: 180 * DAY_MS, recording: 30 * DAY_MS, search: 7 * DAY_MS, negative: DAY_MS })

interface CacheRow { valueJson: string | null, expiresAt: number }

export interface MusicBrainzRepositoryOptions extends MusicBrainzClientOptions {
  clientFactory?: (baseUrl: string) => Pick<MusicBrainzClient, 'getJson'>
}

const asObject = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value != null
  ? value as Record<string, unknown>
  : null

const parseRecording = (value: unknown): MusicBrainzRecording | null => {
  const row = asObject(value)
  if (row == null || typeof row.id !== 'string' || typeof row.title !== 'string') return null
  const artistCredit = Array.isArray(row['artist-credit']) ? row['artist-credit'] : []
  const artists = artistCredit.flatMap(item => {
    const credit = asObject(item)
    const artist = asObject(credit?.artist)
    const name = typeof credit?.name === 'string' ? credit.name : artist?.name
    return typeof name === 'string' ? [name] : []
  })
  const releases = Array.isArray(row.releases) ? row.releases : []
  const releaseGroupMbids = releases.flatMap(item => {
    const release = asObject(item)
    const group = asObject(release?.['release-group'])
    return typeof group?.id === 'string' ? [group.id] : []
  })
  const relations = Array.isArray(row.relations) ? row.relations : []
  const workMbids = relations.flatMap(item => {
    const relation = asObject(item)
    const work = asObject(relation?.work)
    return typeof work?.id === 'string' ? [work.id] : []
  })
  return {
    recordingMbid: row.id,
    title: row.title,
    artists,
    durationMs: typeof row.length === 'number' ? row.length : null,
    releaseGroupMbids: [...new Set(releaseGroupMbids)],
    workMbids: [...new Set(workMbids)],
    firstReleaseDate: typeof row['first-release-date'] === 'string' ? row['first-release-date'] : null,
  }
}

const trackIsrc = (track: RecommendationTrack): string | null => {
  for (const value of [track.isrc, asObject(track.meta)?.isrc]) {
    if (typeof value === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value.replace(/[-\s]/g, ''))) {
      return value.replace(/[-\s]/g, '').toUpperCase()
    }
  }
  return null
}

export class SqliteMusicBrainzRepository {
  private readonly now: () => number
  private readonly clientFactory: (baseUrl: string) => Pick<MusicBrainzClient, 'getJson'>

  constructor(options: MusicBrainzRepositoryOptions = {}) {
    this.now = options.now ?? Date.now
    this.clientFactory = options.clientFactory ?? (baseUrl => new MusicBrainzClient(baseUrl, options))
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS recommendation_musicbrainz_cache (
        endpoint TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        value_json TEXT,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY(endpoint, cache_key)
      );
      CREATE INDEX IF NOT EXISTS recommendation_musicbrainz_cache_expiry ON recommendation_musicbrainz_cache(expires_at);
    `)
    getDB().prepare('DELETE FROM recommendation_musicbrainz_cache WHERE expires_at < ?').run(this.now())
  }

  async testConnection(baseUrl: string): Promise<MusicBrainzConnectionTestResult> {
    let normalizedBaseUrl: string
    try {
      normalizedBaseUrl = normalizeMusicBrainzBaseUrl(baseUrl)
      await this.clientFactory(normalizedBaseUrl).getJson('recording?query=recording%3A%22test%22&limit=1&fmt=json')
      return { ok: true, normalizedBaseUrl, errorCode: null }
    } catch (error) {
      const code = error instanceof MusicBrainzClientError ? error.code : 'invalid_url'
      return { ok: false, normalizedBaseUrl: typeof baseUrl === 'string' ? baseUrl.trim() : '', errorCode: code }
    }
  }

  async matchRecording(baseUrl: string, track: RecommendationTrack): Promise<MusicBrainzRecordingMatch | null> {
    const endpoint = normalizeMusicBrainzBaseUrl(baseUrl)
    const canonical = canonicalizeTrack(track)
    if (canonical == null) return null
    const fingerprint = createHash('sha256').update(JSON.stringify({
      title: canonical.normalizedTitle,
      artists: canonical.normalizedArtists,
      duration: track.interval ?? null,
      isrc: trackIsrc(track),
    })).digest('hex')
    const cacheKey = `match:${fingerprint}`
    const cached = this.read<MusicBrainzRecordingMatch>(endpoint, cacheKey)
    if (cached.hit) return cached.value

    const client = this.clientFactory(endpoint)
    const isrc = trackIsrc(track)
    const path = isrc == null
      ? `recording?query=${encodeURIComponent(`recording:"${track.name}" AND artist:"${track.singer}"`)}&limit=5&fmt=json`
      : `recording?query=${encodeURIComponent(`isrc:${isrc}`)}&limit=5&fmt=json`
    const response = asObject(await client.getJson(path))
    const rows = Array.isArray(response?.recordings) ? response.recordings : []
    const matches = rows.flatMap(item => {
      const row = asObject(item)
      const recording = parseRecording(item)
      const score = typeof row?.score === 'number' ? row.score : 0
      return recording == null ? [] : [{ recording, score }]
    }).filter(item => item.score >= (isrc == null ? 80 : 95))
    const first = matches[0]
    const value: MusicBrainzRecordingMatch | null = first == null ? null : {
      recording: first.recording,
      method: isrc == null ? 'search' : 'isrc',
      confidence: first.score / 100,
    }
    this.write(endpoint, cacheKey, value, value == null ? TTL.negative : (isrc == null ? TTL.search : TTL.mapping))
    if (value != null) this.write(endpoint, `recording:${value.recording.recordingMbid}`, value.recording, TTL.recording)
    return value
  }

  async relatedRecordings(baseUrl: string, recordingMbids: readonly string[]): Promise<MusicBrainzRecording[]> {
    const endpoint = normalizeMusicBrainzBaseUrl(baseUrl)
    const client = this.clientFactory(endpoint)
    const artists = new Set<string>()
    const seedIds = new Set(recordingMbids)
    for (const mbid of [...new Set(recordingMbids)].slice(0, 10)) {
      const seed = await this.recording(endpoint, client, mbid)
      if (seed == null) continue
      for (const artist of seed.artists.slice(0, 1)) if (normalizeLabel(artist) !== '') artists.add(artist)
    }
    if (artists.size === 0) return []
    const normalizedArtists = [...artists].map(normalizeLabel).sort()
    const key = `artist-search:${createHash('sha256').update(JSON.stringify(normalizedArtists)).digest('hex')}`
    const cached = this.read<MusicBrainzRecording[]>(endpoint, key)
    if (cached.hit) return cached.value ?? []
    const query = [...artists].map(artist => `artist:"${artist}"`).join(' OR ')
    const response = asObject(await client.getJson(`recording?query=${encodeURIComponent(`(${query})`)}&limit=50&fmt=json`))
    const related = (Array.isArray(response?.recordings) ? response.recordings : []).flatMap(item => {
      const recording = parseRecording(item)
      return recording == null || seedIds.has(recording.recordingMbid) ? [] : [recording]
    })
    this.write(endpoint, key, related, related.length === 0 ? TTL.negative : TTL.search)
    return related
  }

  private async recording(endpoint: string, client: Pick<MusicBrainzClient, 'getJson'>, mbid: string): Promise<MusicBrainzRecording | null> {
    const key = `recording:${mbid}`
    const cached = this.read<MusicBrainzRecording>(endpoint, key)
    if (cached.hit) return cached.value
    const value = parseRecording(await client.getJson(`recording/${encodeURIComponent(mbid)}?inc=artists+releases+release-groups+work-rels&fmt=json`))
    this.write(endpoint, key, value, value == null ? TTL.negative : TTL.recording)
    return value
  }

  private read<T>(endpoint: string, key: string): { hit: boolean, value: T | null } {
    const row = getDB().prepare('SELECT value_json AS valueJson, expires_at AS expiresAt FROM recommendation_musicbrainz_cache WHERE endpoint=? AND cache_key=?')
      .get(endpoint, key) as CacheRow | undefined
    if (row == null || row.expiresAt < this.now()) return { hit: false, value: null }
    return { hit: true, value: row.valueJson == null ? null : JSON.parse(row.valueJson) as T }
  }

  private write(endpoint: string, key: string, value: unknown, ttl: number): void {
    getDB().prepare(`INSERT INTO recommendation_musicbrainz_cache(endpoint, cache_key, value_json, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint, cache_key) DO UPDATE SET value_json=excluded.value_json, expires_at=excluded.expires_at`)
      .run(endpoint, key, value == null ? null : JSON.stringify(value), this.now() + ttl)
  }
}
