import { getDB } from '../db/core/db'
import { canonicalizeTrack, toTrackVariant } from './identity'
import { recommendationPolicy } from './policy'
import type { CanonicalTrack, RecommendationTag, RecommendationTrack, TrackVariant } from './types'

export interface CatalogPlaylistInput {
  source: string
  playlistId: string
  name: string
  description: string
  labels: string[]
  sampledAt: number
  expiresAt: number
  reliability: number
  tracks: Array<Record<string, unknown>>
}

export interface CatalogPlaylistFact {
  key: string
  name: string
  description: string
  labels: string[]
  sampledAt: number
  reliability: number
  members: string[]
}

export interface CatalogCandidate {
  canonical: CanonicalTrack
  variants: TrackVariant[]
  tags: RecommendationTag[]
}

const forbiddenMetadataKeys = /^(?:url|musicUrl|streamUrl|headers?|cookie|token|filePath|path)$/i

const safeMetadata = (value: unknown, depth = 0): unknown => {
  if (depth > 4 || value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(child => safeMetadata(child, depth + 1))
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !forbiddenMetadataKeys.test(key))
    .map(([key, child]) => [key, safeMetadata(child, depth + 1)]))
}

export const projectCatalogTrack = (track: RecommendationTrack): RecommendationTrack => safeMetadata(track) as RecommendationTrack

const parseJson = <T>(value: string): T => JSON.parse(value) as T

export class CatalogRepository {
  constructor() {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS recommendation_catalog_track (
        canonical_id TEXT PRIMARY KEY,
        normalized_title TEXT NOT NULL,
        normalized_artists_json TEXT NOT NULL,
        normalized_album TEXT NOT NULL,
        version_marker TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recommendation_catalog_variant (
        canonical_id TEXT NOT NULL REFERENCES recommendation_catalog_track(canonical_id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_track_id TEXT NOT NULL,
        track_json TEXT NOT NULL,
        metadata_quality REAL NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY(source, source_track_id)
      );
      CREATE INDEX IF NOT EXISTS recommendation_variant_canonical ON recommendation_catalog_variant(canonical_id);
      CREATE TABLE IF NOT EXISTS recommendation_catalog_playlist (
        playlist_key TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        labels_json TEXT NOT NULL,
        sampled_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        reliability REAL NOT NULL,
        UNIQUE(source, playlist_id)
      );
      CREATE TABLE IF NOT EXISTS recommendation_catalog_member (
        playlist_key TEXT NOT NULL REFERENCES recommendation_catalog_playlist(playlist_key) ON DELETE CASCADE,
        canonical_id TEXT NOT NULL REFERENCES recommendation_catalog_track(canonical_id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY(playlist_key, canonical_id)
      );
      CREATE INDEX IF NOT EXISTS recommendation_member_track ON recommendation_catalog_member(canonical_id);
      CREATE TABLE IF NOT EXISTS recommendation_track_tag (
        canonical_id TEXT NOT NULL REFERENCES recommendation_catalog_track(canonical_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL,
        support INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(canonical_id, kind, value)
      );
      CREATE TABLE IF NOT EXISTS recommendation_track_neighbor (
        seed_id TEXT NOT NULL REFERENCES recommendation_catalog_track(canonical_id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL REFERENCES recommendation_catalog_track(canonical_id) ON DELETE CASCADE,
        similarity REAL NOT NULL,
        shared_playlist_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(seed_id, candidate_id)
      );
    `)
  }

  replacePlaylist(input: CatalogPlaylistInput): Set<string> {
    const database = getDB()
    const key = `${input.source}:${input.playlistId}`
    return database.transaction(() => {
      const previous = database.prepare('SELECT canonical_id AS canonicalId FROM recommendation_catalog_member WHERE playlist_key=?')
        .all(key) as Array<{ canonicalId: string }>
      const affected = new Set(previous.map(row => row.canonicalId))
      const members = new Map<string, { canonical: CanonicalTrack, variant: TrackVariant }>()
      for (const raw of input.tracks) {
        const canonical = canonicalizeTrack(raw)
        const variant = toTrackVariant(raw, input.sampledAt)
        if (canonical == null || variant == null || members.has(canonical.canonicalTrackId)) continue
        members.set(canonical.canonicalTrackId, { canonical, variant: { ...variant, track: projectCatalogTrack(variant.track) } })
      }
      const upsertTrack = database.prepare(`
        INSERT INTO recommendation_catalog_track(canonical_id, normalized_title, normalized_artists_json, normalized_album, version_marker, first_seen_at, last_seen_at)
        VALUES (@canonicalTrackId, @normalizedTitle, @normalizedArtists, @normalizedAlbum, @versionMarker, @now, @now)
        ON CONFLICT(canonical_id) DO UPDATE SET normalized_album=excluded.normalized_album, last_seen_at=excluded.last_seen_at
      `)
      const upsertVariant = database.prepare(`
        INSERT INTO recommendation_catalog_variant(canonical_id, source, source_track_id, track_json, metadata_quality, last_seen_at)
        VALUES (@canonicalTrackId, @source, @sourceTrackId, @trackJson, @metadataQuality, @lastSeenAt)
        ON CONFLICT(source, source_track_id) DO UPDATE SET canonical_id=excluded.canonical_id, track_json=excluded.track_json,
          metadata_quality=excluded.metadata_quality, last_seen_at=excluded.last_seen_at
      `)
      for (const { canonical, variant } of members.values()) {
        upsertTrack.run({ ...canonical, normalizedArtists: JSON.stringify(canonical.normalizedArtists), now: input.sampledAt })
        upsertVariant.run({ ...variant, trackJson: JSON.stringify(variant.track) })
        affected.add(canonical.canonicalTrackId)
      }
      database.prepare(`
        INSERT INTO recommendation_catalog_playlist(playlist_key, source, playlist_id, name, description, labels_json, sampled_at, expires_at, reliability)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(playlist_key) DO UPDATE SET name=excluded.name, description=excluded.description, labels_json=excluded.labels_json,
          sampled_at=excluded.sampled_at, expires_at=excluded.expires_at, reliability=excluded.reliability
      `).run(key, input.source, input.playlistId, input.name, input.description, JSON.stringify(input.labels), input.sampledAt, input.expiresAt, input.reliability)
      database.prepare('DELETE FROM recommendation_catalog_member WHERE playlist_key=?').run(key)
      const insertMember = database.prepare('INSERT INTO recommendation_catalog_member(playlist_key, canonical_id, position) VALUES (?, ?, ?)')
      let position = 0
      for (const canonicalId of members.keys()) insertMember.run(key, canonicalId, position++)
      return affected
    })()
  }

  expirePlaylists(now: number): Set<string> {
    return getDB().transaction(() => {
      const rows = getDB().prepare(`
        SELECT DISTINCT m.canonical_id AS canonicalId FROM recommendation_catalog_member m
        JOIN recommendation_catalog_playlist p ON p.playlist_key=m.playlist_key WHERE p.expires_at < ?
      `).all(now) as Array<{ canonicalId: string }>
      getDB().prepare('DELETE FROM recommendation_catalog_playlist WHERE expires_at < ?').run(now)
      return new Set(rows.map(row => row.canonicalId))
    })()
  }

  playlistSampledAt(source: string, playlistId: string): number | null {
    const row = getDB().prepare('SELECT sampled_at AS sampledAt FROM recommendation_catalog_playlist WHERE source=? AND playlist_id=?')
      .get(source, playlistId) as { sampledAt: number } | undefined
    return row?.sampledAt ?? null
  }

  activeSources(now: number, allowedSources?: ReadonlySet<string>): string[] {
    const rows = getDB().prepare(`
      SELECT DISTINCT p.source FROM recommendation_catalog_playlist p
      WHERE p.expires_at >= ? AND EXISTS (
        SELECT 1 FROM recommendation_catalog_member m WHERE m.playlist_key=p.playlist_key
      ) ORDER BY p.source
    `).all(now) as Array<{ source: string }>
    return rows.map(row => row.source).filter(source => allowedSources?.has(source) ?? true)
  }

  playlistsForSeeds(seedIds: ReadonlySet<string>, now: number): CatalogPlaylistFact[] {
    if (seedIds.size === 0) return []
    const placeholders = [...seedIds].map(() => '?').join(',')
    const keys = getDB().prepare(`SELECT DISTINCT playlist_key AS key FROM recommendation_catalog_member WHERE canonical_id IN (${placeholders})`)
      .all(...seedIds) as Array<{ key: string }>
    if (keys.length === 0) return []
    const keyPlaceholders = keys.map(() => '?').join(',')
    const playlists = getDB().prepare(`
      SELECT playlist_key AS key, name, description, labels_json AS labelsJson, sampled_at AS sampledAt, reliability
      FROM recommendation_catalog_playlist WHERE expires_at >= ? AND playlist_key IN (${keyPlaceholders})
    `).all(now, ...keys.map(row => row.key)) as Array<{ key: string, name: string, description: string, labelsJson: string, sampledAt: number, reliability: number }>
    const members = getDB().prepare(`SELECT playlist_key AS key, canonical_id AS canonicalId FROM recommendation_catalog_member WHERE playlist_key IN (${keyPlaceholders}) ORDER BY position`)
      .all(...keys.map(row => row.key)) as Array<{ key: string, canonicalId: string }>
    const byPlaylist = new Map<string, string[]>()
    for (const member of members) byPlaylist.set(member.key, [...(byPlaylist.get(member.key) ?? []), member.canonicalId])
    return playlists.map(row => ({ ...row, labels: parseJson<string[]>(row.labelsJson), members: byPlaylist.get(row.key) ?? [] }))
  }

  replaceRelations(seedIds: ReadonlySet<string>, neighbors: Map<string, Array<{ candidateId: string, similarity: number, shared: number }>>, tags: Map<string, RecommendationTag[]>, now: number): void {
    getDB().transaction(() => {
      const deleteNeighbors = getDB().prepare('DELETE FROM recommendation_track_neighbor WHERE seed_id=?')
      const deleteTags = getDB().prepare('DELETE FROM recommendation_track_tag WHERE canonical_id=?')
      const insertNeighbor = getDB().prepare('INSERT INTO recommendation_track_neighbor(seed_id, candidate_id, similarity, shared_playlist_count, updated_at) VALUES (?, ?, ?, ?, ?)')
      const insertTag = getDB().prepare('INSERT INTO recommendation_track_tag(canonical_id, kind, value, confidence, support, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const seedId of seedIds) {
        deleteNeighbors.run(seedId)
        deleteTags.run(seedId)
        for (const item of neighbors.get(seedId) ?? []) insertNeighbor.run(seedId, item.candidateId, item.similarity, item.shared, now)
        for (const tag of tags.get(seedId) ?? []) insertTag.run(seedId, tag.kind, tag.value, tag.confidence, tag.support, now)
      }
    })()
  }

  candidates(now?: number): CatalogCandidate[] {
    const tracks = getDB().prepare(`SELECT canonical_id AS canonicalTrackId, normalized_title AS normalizedTitle,
      normalized_artists_json AS normalizedArtists, normalized_album AS normalizedAlbum, version_marker AS versionMarker
      FROM recommendation_catalog_track t
      WHERE EXISTS (SELECT 1 FROM recommendation_catalog_member m WHERE m.canonical_id=t.canonical_id)`)
      .all() as Array<Omit<CanonicalTrack, 'normalizedArtists'> & { normalizedArtists: string }>
    const variants = getDB().prepare(`SELECT canonical_id AS canonicalTrackId, source, source_track_id AS sourceTrackId,
      track_json AS trackJson, metadata_quality AS metadataQuality, last_seen_at AS lastSeenAt FROM recommendation_catalog_variant`)
      .all() as Array<Omit<TrackVariant, 'track'> & { trackJson: string }>
    const tags = getDB().prepare('SELECT canonical_id AS canonicalId, kind, value, confidence, support FROM recommendation_track_tag')
      .all() as Array<{ canonicalId: string } & RecommendationTag>
    const variantCutoff = now == null ? null : now - recommendationPolicy.playlistExpiryDays * 86_400_000
    const variantsByTrack = new Map<string, TrackVariant[]>()
    for (const { trackJson, ...variant } of variants) {
      if (variantCutoff != null && variant.lastSeenAt < variantCutoff) continue
      variantsByTrack.set(variant.canonicalTrackId, [...(variantsByTrack.get(variant.canonicalTrackId) ?? []), { ...variant, track: parseJson<RecommendationTrack>(trackJson) }])
    }
    const tagsByTrack = new Map<string, RecommendationTag[]>()
    for (const { canonicalId, ...tag } of tags) tagsByTrack.set(canonicalId, [...(tagsByTrack.get(canonicalId) ?? []), tag])
    return tracks.map(row => ({
      canonical: { ...row, normalizedArtists: parseJson<string[]>(row.normalizedArtists) },
      variants: variantsByTrack.get(row.canonicalTrackId) ?? [],
      tags: tagsByTrack.get(row.canonicalTrackId) ?? [],
    }))
  }

  neighbors(seedIds: readonly string[]): Map<string, Array<{ candidateId: string, similarity: number }>> {
    const result = new Map<string, Array<{ candidateId: string, similarity: number }>>()
    if (seedIds.length === 0) return result
    const placeholders = seedIds.map(() => '?').join(',')
    const rows = getDB().prepare(`SELECT seed_id AS seedId, candidate_id AS candidateId, similarity FROM recommendation_track_neighbor WHERE seed_id IN (${placeholders}) ORDER BY similarity DESC, candidate_id`)
      .all(...seedIds) as Array<{ seedId: string, candidateId: string, similarity: number }>
    for (const row of rows) result.set(row.seedId, [...(result.get(row.seedId) ?? []), { candidateId: row.candidateId, similarity: row.similarity }])
    return result
  }
}
