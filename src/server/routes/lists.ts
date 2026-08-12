import { Type } from '@fastify/type-provider-typebox'
import {
  checkListExistMusic,
  createUserLists,
  getAllUserList,
  getListMusics,
  getMusicExistListIds,
  listDataOverwrite,
  musicOverwrite,
  musicsAdd,
  musicsClear,
  musicsMove,
  musicsPositionUpdate,
  musicsRemove,
  musicsUpdate,
  removeUserLists,
  updateUserLists,
  updateUserListsPosition,
} from '../db/lists'
import { ApiError } from '../errors'
import { LIST_IDS } from '../../common/constants'
import type { ServiceEvents } from './events'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { Identifier, IdParams, Playlist, PlaylistDetail, PlaylistTrackParams, Track } from '../api/schemas/domain'

interface ListBody {
  id?: string
  name?: string
  source?: TuneFlow.OnlineSource
  sourceListId?: string
  locationUpdateTime?: number | null
}

interface TracksBody {
  tracks?: TuneFlow.Music.MusicInfo[]
  position?: TuneFlow.AddMusicLocationType
}

const getList = (id: string): TuneFlow.List.UserListInfo => {
  const list = getAllUserList().find(list => list.id === id)
  if (list == null) throw new ApiError(404, 'LIST_NOT_FOUND', `List not found: ${id}`)
  return list
}

const builtInListIds = new Set<string>([LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP, LIST_IDS.DOWNLOAD])
const libraryBuiltInLists = [
  { id: LIST_IDS.DEFAULT, name: 'list__name_default' },
  { id: LIST_IDS.LOVE, name: 'list__name_love' },
]

const ensureListId = (id: unknown): string => {
  if (typeof id !== 'string' || id.length === 0) throw new ApiError(400, 'INVALID_LIST', 'List id is required')
  if (!builtInListIds.has(id)) getList(id)
  return id
}

const ensureStringArray = (value: unknown, message: string): string[] => {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new ApiError(400, 'INVALID_LIST', message)
  }
  return value
}

const ensureMusicArray = (value: unknown): TuneFlow.Music.MusicInfo[] => {
  if (!Array.isArray(value) || value.some(info => typeof info !== 'object' || info == null || typeof (info as { id?: unknown }).id !== 'string')) {
    throw new ApiError(400, 'INVALID_TRACKS', 'Tracks must be an array of music records')
  }
  return value as TuneFlow.Music.MusicInfo[]
}

const ensureUserListInfo = (value: unknown): TuneFlow.List.UserListInfo => {
  const list = value as Partial<TuneFlow.List.UserListInfo> | null
  if (list == null || typeof list !== 'object' || typeof list.id !== 'string' || list.id.length === 0 || typeof list.name !== 'string' || list.name.length === 0) {
    throw new ApiError(400, 'INVALID_LIST', 'List id and name are required')
  }
  return list as TuneFlow.List.UserListInfo
}

const playlistResponses = { 400: ErrorResponses[400], 404: ErrorResponses[404], 409: ErrorResponses[409], 500: ErrorResponses[500] }
const trackArrayResponse = ApiSuccess(Type.Array(Track))

export const registerListRoutes = (app: ApiFastifyInstance, events?: ServiceEvents): void => {
  app.get('/api/v1/playlists', {
    schema: {
      operationId: 'listPlaylists',
      tags: ['Playlists'],
      summary: 'List playlists',
      querystring: Type.Object({ includeBuiltIn: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Array(Playlist)), ...playlistResponses },
    },
  }, async(request) => ({
    data: request.query.includeBuiltIn
      ? [...libraryBuiltInLists, ...getAllUserList()]
      : getAllUserList(),
  }))

  app.post('/api/v1/playlists', {
    schema: {
      operationId: 'createPlaylists',
      tags: ['Playlists'],
      summary: 'Create playlists',
      body: Type.Object({ position: Type.Integer(), playlists: Type.Array(Playlist, { minItems: 1 }) }, { additionalProperties: false }),
      response: { 201: ApiSuccess(Type.Array(Playlist)), ...playlistResponses },
    },
  }, async(request, reply) => {
    const body = request.body as { position?: unknown, playlists?: unknown } | null
    if (body == null || !Number.isInteger(body.position) || !Array.isArray(body.playlists)) throw new ApiError(400, 'INVALID_LIST', 'Playlist position and playlists are required')
    const listInfos = body.playlists.map(ensureUserListInfo)
    const existingIds = new Set(getAllUserList().map(list => list.id))
    const batchIds = new Set<string>()
    for (const list of listInfos) {
      if (existingIds.has(list.id) || batchIds.has(list.id)) throw new ApiError(409, 'LIST_EXISTS', `List already exists: ${list.id}`)
      batchIds.add(list.id)
    }
    createUserLists(body.position as number, listInfos)
    events?.publish('playlists.created', { position: body.position, listInfos })
    return reply.code(201).send({ data: getAllUserList() })
  })

  app.patch('/api/v1/playlists', {
    schema: {
      operationId: 'updatePlaylists',
      tags: ['Playlists'],
      summary: 'Update playlists',
      body: Type.Object({ playlists: Type.Array(Playlist, { minItems: 1 }) }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Array(Playlist)), ...playlistResponses },
    },
  }, async(request) => {
    const body = request.body as { playlists?: unknown } | null
    if (body == null || !Array.isArray(body.playlists)) throw new ApiError(400, 'INVALID_LIST', 'Playlists are required')
    const listInfos = body.playlists.map(value => {
      const update = ensureUserListInfo(value)
      return { ...getList(update.id), ...update, id: update.id }
    })
    updateUserLists(listInfos)
    events?.publish('playlists.updated', listInfos)
    return { data: getAllUserList() }
  })

  app.get('/api/v1/playlists/:id', {
    schema: {
      operationId: 'getPlaylist',
      tags: ['Playlists'],
      summary: 'Get a playlist and its tracks',
      params: IdParams,
      response: { 200: ApiSuccess(PlaylistDetail), ...playlistResponses },
    },
  }, async(request) => {
    const id = ensureListId((request.params as { id: string }).id)
    const list = builtInListIds.has(id)
      ? { id, name: id, locationUpdateTime: null }
      : getList(id)
    return { data: { ...list, tracks: getListMusics(id) } }
  })

  app.patch('/api/v1/playlists/:id', {
    schema: {
      operationId: 'updatePlaylist',
      tags: ['Playlists'],
      summary: 'Update one playlist',
      params: IdParams,
      body: Type.Partial(Type.Omit(Playlist, ['id']), { additionalProperties: false }),
      response: { 200: ApiSuccess(Playlist), ...playlistResponses },
    },
  }, async(request) => {
    const original = getList((request.params as { id: string }).id)
    const body = (request.body ?? {}) as ListBody
    const updated = { ...original, ...body, id: original.id, locationUpdateTime: body.locationUpdateTime ?? original.locationUpdateTime ?? null }
    if (typeof updated.name !== 'string' || updated.name.length === 0) throw new ApiError(400, 'INVALID_LIST', 'List name is required')
    updateUserLists([updated])
    events?.publish('playlists.updated', [updated])
    return { data: getList(original.id) }
  })

  app.delete('/api/v1/playlists/:id', {
    schema: {
      operationId: 'deletePlaylist',
      tags: ['Playlists'],
      summary: 'Delete one playlist',
      params: IdParams,
      response: { 204: Type.Null(), ...playlistResponses },
    },
  }, async(request, reply) => {
    const list = getList((request.params as { id: string }).id)
    removeUserLists([list.id])
    events?.publish('playlists.deleted', [list.id])
    return reply.code(204).send()
  })

  app.post('/api/v1/playlists/:id/tracks', {
    schema: {
      operationId: 'addPlaylistTracks',
      tags: ['Playlists'],
      summary: 'Add tracks to a playlist',
      params: IdParams,
      body: Type.Object({ tracks: Type.Array(Track), position: Type.Optional(Type.Union([Type.Literal('top'), Type.Literal('bottom')])) }, { additionalProperties: false }),
      response: { 201: trackArrayResponse, ...playlistResponses },
    },
  }, async(request, reply) => {
    const id = ensureListId((request.params as { id: string }).id)
    const body = (request.body ?? {}) as TracksBody
    if (!Array.isArray(body.tracks)) throw new ApiError(400, 'INVALID_TRACKS', 'Tracks must be an array')
    musicsAdd(id, body.tracks, body.position ?? 'bottom')
    events?.publish('playlist.tracks.added', { id, musicInfos: body.tracks, addMusicLocationType: body.position ?? 'bottom' })
    return reply.code(201).send({ data: getListMusics(id) })
  })

  app.post('/api/v1/playlists/:id/tracks/remove', {
    schema: {
      operationId: 'removePlaylistTracks',
      tags: ['Playlists'],
      summary: 'Remove tracks from a playlist',
      params: IdParams,
      body: Type.Object({ trackIds: Type.Array(Identifier) }, { additionalProperties: false }),
      response: { 200: trackArrayResponse, ...playlistResponses },
    },
  }, async(request) => {
    const id = ensureListId((request.params as { id: string }).id)
    const body = (request.body ?? {}) as { trackIds?: string[] }
    if (!Array.isArray(body.trackIds)) throw new ApiError(400, 'INVALID_TRACKS', 'Track ids must be an array')
    musicsRemove(id, body.trackIds)
    events?.publish('playlist.tracks.removed', { listId: id, ids: body.trackIds })
    return { data: getListMusics(id) }
  })

  app.post('/api/v1/playlists/reorder', {
    schema: {
      operationId: 'reorderPlaylists',
      tags: ['Playlists'],
      summary: 'Reorder playlists',
      body: Type.Object({ position: Type.Integer(), ids: Type.Array(Identifier) }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Array(Playlist)), ...playlistResponses },
    },
  }, async(request) => {
    const body = request.body as Partial<TuneFlow.List.ListActionUpdatePosition> | null
    if (body == null || !Number.isInteger(body.position)) throw new ApiError(400, 'INVALID_LIST', 'List position is required')
    const ids = ensureStringArray(body.ids, 'List ids must be an array')
    for (const id of ids) getList(id)
    updateUserListsPosition(body.position!, ids)
    events?.publish('playlists.reordered', request.body)
    return { data: getAllUserList() }
  })

  app.post('/api/v1/playlists/tracks/move', {
    schema: {
      operationId: 'movePlaylistTracks',
      tags: ['Playlists'],
      summary: 'Move tracks between playlists',
      body: Type.Object({ fromId: Identifier, toId: Identifier, musicInfos: Type.Array(Track), addMusicLocationType: Type.Union([Type.Literal('top'), Type.Literal('bottom')]) }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Null()), ...playlistResponses },
    },
  }, async(request) => {
    const body = request.body as Partial<TuneFlow.List.ListActionMusicMove> | null
    const fromId = ensureListId(body?.fromId)
    const toId = ensureListId(body?.toId)
    const musicInfos = ensureMusicArray(body?.musicInfos)
    if (body?.addMusicLocationType !== 'top' && body?.addMusicLocationType !== 'bottom') throw new ApiError(400, 'INVALID_TRACKS', 'Music location must be top or bottom')
    musicsMove(fromId, toId, musicInfos, body.addMusicLocationType)
    events?.publish('playlist.tracks.moved', request.body)
    return { data: null }
  })

  app.patch('/api/v1/playlists/:id/tracks', {
    schema: {
      operationId: 'updatePlaylistTracks',
      tags: ['Playlists'],
      summary: 'Update tracks in a playlist',
      params: IdParams,
      body: Type.Object({ tracks: Type.Array(Track) }, { additionalProperties: false }),
      response: { 200: trackArrayResponse, ...playlistResponses },
    },
  }, async(request) => {
    const listId = ensureListId((request.params as { id: string }).id)
    const tracks = ensureMusicArray((request.body as { tracks?: unknown }).tracks)
    const updates = tracks.map(musicInfo => ({ id: listId, musicInfo })) as TuneFlow.List.ListActionMusicUpdate
    musicsUpdate(updates)
    events?.publish('playlist.tracks.updated', updates)
    return { data: getListMusics(listId) }
  })

  app.post('/api/v1/playlists/:id/tracks/reorder', {
    schema: {
      operationId: 'reorderPlaylistTracks',
      tags: ['Playlists'],
      summary: 'Reorder tracks in a playlist',
      params: IdParams,
      body: Type.Object({ position: Type.Integer(), trackIds: Type.Array(Identifier) }, { additionalProperties: false }),
      response: { 200: trackArrayResponse, ...playlistResponses },
    },
  }, async(request) => {
    const listId = ensureListId((request.params as { id: string }).id)
    const body = request.body as { position?: number, trackIds?: unknown }
    if (!Number.isInteger(body?.position)) throw new ApiError(400, 'INVALID_TRACKS', 'Track position is required')
    const ids = ensureStringArray(body?.trackIds, 'Track ids must be an array')
    const existingIds = new Set(getListMusics(listId).map(info => info.id))
    for (const id of ids) if (!existingIds.has(id)) throw new ApiError(404, 'TRACK_NOT_FOUND', `Track not found: ${id}`)
    musicsPositionUpdate(listId, body.position!, ids)
    events?.publish('playlist.tracks.reordered', { listId, position: body.position, ids })
    return { data: getListMusics(listId) }
  })

  app.put('/api/v1/playlists/:id/tracks', {
    schema: {
      operationId: 'replacePlaylistTracks',
      tags: ['Playlists'],
      summary: 'Replace all tracks in a playlist',
      params: IdParams,
      body: Type.Object({ tracks: Type.Array(Track) }, { additionalProperties: false }),
      response: { 200: trackArrayResponse, ...playlistResponses },
    },
  }, async(request) => {
    const listId = ensureListId((request.params as { id: string }).id)
    const musicInfos = ensureMusicArray((request.body as { tracks?: unknown }).tracks)
    musicOverwrite(listId, musicInfos)
    events?.publish('playlist.tracks.replaced', { listId, musicInfos })
    return { data: getListMusics(listId) }
  })

  app.delete('/api/v1/playlists/:id/tracks', {
    schema: {
      operationId: 'clearPlaylistTracks',
      tags: ['Playlists'],
      summary: 'Clear all tracks from a playlist',
      params: IdParams,
      response: { 204: Type.Null(), ...playlistResponses },
    },
  }, async(request, reply) => {
    const id = ensureListId((request.params as { id: string }).id)
    musicsClear([id])
    events?.publish('playlist.tracks.cleared', [id])
    return reply.code(204).send()
  })

  app.post('/api/v1/playlists/import', {
    schema: {
      operationId: 'importPlaylists',
      tags: ['Playlists'],
      summary: 'Replace complete playlist state',
      body: Type.Object({
        defaultList: Type.Array(Track),
        loveList: Type.Array(Track),
        tempList: Type.Optional(Type.Array(Track)),
        userList: Type.Array(Type.Intersect([Playlist, Type.Object({ list: Type.Array(Track) })])),
      }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Null()), ...playlistResponses },
    },
  }, async(request) => {
    const body = request.body as Partial<TuneFlow.List.ListActionDataOverwrite> | null
    if (body == null || !Array.isArray(body.defaultList) || !Array.isArray(body.loveList) || !Array.isArray(body.userList)) {
      throw new ApiError(400, 'INVALID_LIST', 'Full list data is required')
    }
    for (const list of body.userList) {
      ensureUserListInfo(list)
      ensureMusicArray(list.list)
    }
    ensureMusicArray(body.defaultList)
    ensureMusicArray(body.loveList)
    if (body.tempList != null) ensureMusicArray(body.tempList)
    listDataOverwrite(request.body as TuneFlow.List.ListActionDataOverwrite)
    events?.publish('playlists.imported', request.body)
    return { data: null }
  })

  app.get('/api/v1/playlists/:id/tracks/:trackId/exists', {
    schema: {
      operationId: 'checkPlaylistTrack',
      tags: ['Playlists'],
      summary: 'Check track membership',
      params: PlaylistTrackParams,
      response: { 200: ApiSuccess(Type.Boolean()), ...playlistResponses },
    },
  }, async(request) => {
    const params = request.params as { id: string, trackId: string }
    return { data: checkListExistMusic(ensureListId(params.id), params.trackId) }
  })

  app.get('/api/v1/tracks/:id/playlists', {
    schema: {
      operationId: 'listTrackPlaylists',
      tags: ['Playlists'],
      summary: 'List playlists containing a track',
      params: IdParams,
      response: { 200: ApiSuccess(Type.Array(Identifier)), ...playlistResponses },
    },
  }, async(request) => {
    return { data: getMusicExistListIds((request.params as { id: string }).id) }
  })
}
