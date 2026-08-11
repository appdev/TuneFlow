import { Type } from '@fastify/type-provider-typebox'

export const Identifier = Type.String({ minLength: 1 })
export const IdParams = Type.Object({ id: Identifier }, { additionalProperties: false })
export const PlaylistTrackParams = Type.Object({ id: Identifier, trackId: Identifier }, { additionalProperties: false })

// Music-source metadata is intentionally extensible. Browser DTO projection is
// still applied before serialization so private paths and upstream URLs cannot
// cross the Service boundary.
export const Track = Type.Object({
  id: Identifier,
  name: Type.Optional(Type.String()),
  singer: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  interval: Type.Optional(Type.String()),
  meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
}, { additionalProperties: true })

export const Playlist = Type.Object({
  id: Identifier,
  name: Type.String({ minLength: 1 }),
  source: Type.Optional(Type.String()),
  sourceListId: Type.Optional(Type.String()),
  locationUpdateTime: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
}, { additionalProperties: false })

export const PlaylistDetail = Type.Intersect([
  Playlist,
  Type.Object({ tracks: Type.Array(Track) }, { additionalProperties: false }),
])

export const SourceSummary = Type.Object({
  id: Identifier,
  name: Type.String(),
  description: Type.String(),
  version: Type.String(),
  author: Type.String(),
  homepage: Type.String(),
  active: Type.Boolean(),
  sources: Type.Optional(Type.Record(Type.String(), Type.Object({
    type: Type.Literal('music'),
    actions: Type.Array(Type.String()),
    qualitys: Type.Array(Type.String()),
  }, { additionalProperties: false }))),
}, { additionalProperties: false })

export const Download = Type.Object({
  id: Identifier,
  status: Type.Union(['waiting', 'running', 'paused', 'error', 'completed'].map(Type.Literal)),
  musicInfo: Track,
  quality: Type.String(),
  extension: Type.String(),
  fileName: Type.String(),
  downloaded: Type.Number(),
  total: Type.Number(),
  progress: Type.Number(),
  warning: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  listId: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const LibraryTrack = Type.Intersect([
  Track,
  Type.Object({
    musicInfo: Track,
    size: Type.Number(),
    extension: Type.String(),
    codec: Type.Optional(Type.String()),
    streamUrl: Type.String(),
  }),
])
