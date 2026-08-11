import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { Type } from '@fastify/type-provider-typebox'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors'
import type { LibraryScanner } from '../library/scanner'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { IdParams, LibraryTrack } from '../api/schemas/domain'

export const parseLocalRange = (value: string | undefined, size: number): { start: number, end: number } | undefined => {
  if (value == null) return undefined
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(value)
  if (match == null || size <= 0) throw new ApiError(416, 'INVALID_RANGE', 'Invalid byte range')
  if (match[3] != null) {
    const suffixLength = Number(match[3])
    if (suffixLength <= 0) throw new ApiError(416, 'INVALID_RANGE', 'Invalid byte range')
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Number(match[2])
  if (start > end || start >= size) throw new ApiError(416, 'INVALID_RANGE', 'Invalid byte range')
  return { start, end: Math.min(end, size - 1) }
}

const mediaType = (filePath: string): string => ({
  '.ape': 'audio/ape', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')

export const registerLibraryRoutes = (app: ApiFastifyInstance, scanner: LibraryScanner): void => {
  const listResponse = { 200: ApiSuccess(Type.Array(LibraryTrack)), ...ErrorResponses }
  app.get('/api/v1/library/tracks', {
    schema: {
      operationId: 'listLibraryTracks', tags: ['Library'], summary: 'List local library tracks', response: listResponse,
    },
  }, async() => ({ data: await scanner.refresh() }))
  app.post('/api/v1/library/scan', {
    schema: {
      operationId: 'scanLibrary', tags: ['Library'], summary: 'Rescan the local library', response: listResponse,
    },
  }, async() => ({ data: await scanner.refresh() }))
  const stream = async(request: FastifyRequest, reply: FastifyReply) => {
    const entry = scanner.get((request.params as { id: string }).id)
    if (entry == null) throw new ApiError(404, 'LIBRARY_TRACK_NOT_FOUND', 'Library track not found')
    const stat = statSync(entry.filePath)
    let range: { start: number, end: number } | undefined
    try {
      range = parseLocalRange(typeof request.headers.range === 'string' ? request.headers.range : undefined, stat.size)
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 416) void reply.header('content-range', `bytes */${stat.size}`)
      throw error
    }
    const start = range?.start ?? 0
    const end = range?.end ?? stat.size - 1
    void reply.code(range == null ? 200 : 206).headers({
      'content-length': String(end - start + 1),
      ...(range == null ? {} : { 'content-range': `bytes ${start}-${end}/${stat.size}` }),
      'accept-ranges': 'bytes',
      'content-type': mediaType(entry.filePath),
    })
    if (request.method === 'HEAD') return reply.send()
    return reply.send(createReadStream(entry.filePath, { start, end }))
  }
  const streamSchema = { tags: ['Library'], summary: 'Stream a local library track', params: IdParams }
  app.get('/api/v1/library/tracks/:id/stream', { exposeHeadRoute: false, schema: { ...streamSchema, operationId: 'streamLibraryTrack' } }, stream)
  app.head('/api/v1/library/tracks/:id/stream', { schema: { ...streamSchema, operationId: 'headLibraryTrack' } }, stream)
}
