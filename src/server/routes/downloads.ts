import { Type } from '@fastify/type-provider-typebox'
import { ApiError } from '../errors'
import type { DownloadManager } from '../downloads/manager'
import type { DownloadCreateInput } from '../downloads/types'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { Download, IdParams, Track } from '../api/schemas/domain'

const id = (params: unknown): string => (params as { id: string }).id

const downloadResponse = ApiSuccess(Download)
const downloadSchema = (operationId: string, summary: string) => ({
  operationId,
  tags: ['Downloads'],
  summary,
  params: IdParams,
  response: { 200: downloadResponse, ...ErrorResponses },
})

export const registerDownloadRoutes = (app: ApiFastifyInstance, manager: DownloadManager): void => {
  app.get('/api/v1/downloads', {
    schema: {
      operationId: 'listDownloads', tags: ['Downloads'], summary: 'List downloads', response: { 200: ApiSuccess(Type.Array(Download)), ...ErrorResponses },
    },
  }, async() => ({ data: manager.list() }))
  app.post('/api/v1/downloads', {
    schema: {
      operationId: 'createDownload',
      tags: ['Downloads'],
      summary: 'Create a download',
      body: Type.Object({
        musicInfo: Track,
        quality: Type.String({ minLength: 1 }),
        qualityList: Type.Optional(Type.Unknown()),
        listId: Type.Optional(Type.String()),
        skipExisting: Type.Optional(Type.Boolean()),
        qualityPolicy: Type.Optional(Type.Union([Type.Literal('selected'), Type.Literal('highest')])),
      }, { additionalProperties: false }),
      response: { 201: downloadResponse, ...ErrorResponses },
    },
  }, async(request, reply) => {
    const body = request.body as Partial<DownloadCreateInput> | null
    if (body?.musicInfo == null || typeof body.quality !== 'string') throw new ApiError(400, 'INVALID_DOWNLOAD', 'Music info and quality are required')
    return reply.code(201).send({ data: await manager.create(body as DownloadCreateInput) })
  })
  app.post('/api/v1/downloads/:id/start', { schema: downloadSchema('startDownload', 'Start a download') }, async(request) => { await manager.start(id(request.params)); return { data: manager.get(id(request.params)) } })
  app.post('/api/v1/downloads/:id/resume', { schema: downloadSchema('resumeDownload', 'Resume a download') }, async(request) => { await manager.resume(id(request.params)); return { data: manager.get(id(request.params)) } })
  app.post('/api/v1/downloads/:id/pause', { schema: downloadSchema('pauseDownload', 'Pause a download') }, async(request) => { manager.pause(id(request.params)); return { data: manager.get(id(request.params)) } })
  app.delete('/api/v1/downloads/:id', {
    schema: {
      operationId: 'deleteDownload',
      tags: ['Downloads'],
      summary: 'Delete a download',
      params: IdParams,
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async(request, reply) => { await manager.remove(id(request.params)); return reply.code(204).send() })
}
