import { Type } from '@fastify/type-provider-typebox'
import { readFileSync } from 'node:fs'
import { type SourceRepository } from '../sources/repository'
import { SourceWorkerHost } from '../sources/worker-host'
import { requestSourceNetwork, type SourceNetworkOptions } from '../sources/network'
import { SourceServiceError, type SourceRequest, type SourceSummary } from '../sources/types'
import { MAX_SOURCE_SCRIPT_BYTES } from '../../common/constants'
import { ApiError } from '../errors'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { IdParams, SourceSummary as SourceSummarySchema } from '../api/schemas/domain'
import type { ServiceEvents } from './events'

const asApiError = (error: unknown): never => {
  if (error instanceof SourceServiceError) {
    const status = error.code === 'SOURCE_NOT_FOUND'
      ? 404
      : ['SOURCE_DUPLICATE', 'SOURCE_INVALID_METADATA', 'SOURCE_INVALID_URL', 'SOURCE_SCRIPT_TOO_LARGE', 'SOURCE_TARGET_BLOCKED'].includes(error.code) ? 400 : 502
    throw new ApiError(status, error.code, error.message)
  }
  throw error
}

export class SourcesService {
  private readonly workers = new Map<string, SourceWorkerHost>()

  constructor(
    private readonly repository: SourceRepository,
    private readonly publishUpdateAlert: (alert: { log: string, updateUrl?: string }) => void = () => {},
    private readonly networkOptions: SourceNetworkOptions = {},
  ) {}

  list(): SourceSummary[] { return this.repository.listSources() }

  async installSource(script: string): Promise<SourceSummary> {
    try { return await this.repository.installSource(script) } catch (error) { return asApiError(error) }
  }

  async installSourceFromUrl(url: string): Promise<SourceSummary> {
    try {
      let target: URL
      try { target = new URL(url) } catch { throw new SourceServiceError('SOURCE_INVALID_URL', 'Invalid source URL') }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new SourceServiceError('SOURCE_INVALID_URL', 'Source URL must use HTTP or HTTPS')
      const response = await requestSourceNetwork(target.href, {
        headers: { accept: 'application/javascript, text/javascript, text/plain, */*' },
      }, undefined, this.networkOptions)
      if (response.statusCode < 200 || response.statusCode >= 300) throw new SourceServiceError('SOURCE_DOWNLOAD_FAILED', `Source URL returned HTTP ${response.statusCode}`)
      if (response.raw.byteLength > MAX_SOURCE_SCRIPT_BYTES) throw new SourceServiceError('SOURCE_SCRIPT_TOO_LARGE', 'Source script exceeds 1 MiB')
      const script = new TextDecoder().decode(response.raw).replace(/^\ufeff/, '')
      return await this.repository.installSource(script)
    } catch (error) {
      return asApiError(error instanceof SourceServiceError
        ? error
        : new SourceServiceError('SOURCE_DOWNLOAD_FAILED', 'Unable to download source script'))
    }
  }

  async activate(id: string): Promise<SourceSummary> {
    try {
      const worker = await this.getWorker(id)
      const sources = await worker.capabilities()
      const previous = this.repository.listSources().find(source => source.active)
      const source = this.repository.activateSource(id)
      this.repository.setSourceCapabilities(id, sources)
      if (previous != null && previous.id !== id) {
        const previousWorker = this.workers.get(previous.id)
        if (previousWorker != null) await previousWorker.close()
        this.workers.delete(previous.id)
      }
      return { ...source, sources }
    } catch (error) {
      const worker = this.workers.get(id)
      if (worker != null) await worker.close()
      this.workers.delete(id)
      return asApiError(error)
    }
  }

  async requestSource<T>(sourceId: string, request: SourceRequest, signal?: AbortSignal): Promise<T> {
    try {
      if (!this.repository.listSources().some(source => source.id === sourceId && source.active)) throw new SourceServiceError('SOURCE_NOT_FOUND', 'Source is not active')
      return await (await this.getWorker(sourceId)).request<T>(request, signal)
    } catch (error) { return asApiError(error) }
  }

  async remove(id: string): Promise<void> {
    const worker = this.workers.get(id)
    if (worker != null) await worker.close()
    this.workers.delete(id)
    try { this.repository.removeSource(id) } catch (error) { asApiError(error) }
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers.values()].map(async worker => worker.close()))
    this.workers.clear()
  }

  private async getWorker(id: string): Promise<SourceWorkerHost> {
    let worker = this.workers.get(id)
    if (worker != null) return worker
    const source = this.repository.getSource(id)
    worker = new SourceWorkerHost({ ...source, script: readFileSync(source.scriptPath, 'utf8') }, {
      onUpdateAlert: alert => { this.publishUpdateAlert(alert) },
    })
    this.workers.set(id, worker)
    return worker
  }
}

const sourceResponse = ApiSuccess(SourceSummarySchema)
const sourceListResponse = ApiSuccess(Type.Array(SourceSummarySchema))
const sourceInstallBodyLimit = MAX_SOURCE_SCRIPT_BYTES * 6 + 1024

export const registerSourceRoutes = (app: ApiFastifyInstance, service: SourcesService, events?: ServiceEvents): void => {
  app.get('/api/v1/sources', {
    schema: {
      operationId: 'listSources', tags: ['Sources'], summary: 'List installed sources', response: { 200: sourceListResponse, ...ErrorResponses },
    },
  }, async() => ({ data: service.list() }))
  app.post('/api/v1/sources', {
    bodyLimit: sourceInstallBodyLimit,
    schema: {
      operationId: 'installSource',
      tags: ['Sources'],
      summary: 'Install a source script',
      body: Type.Object({ script: Type.String({ minLength: 1, maxLength: MAX_SOURCE_SCRIPT_BYTES }) }, { additionalProperties: false }),
      response: { 200: sourceResponse, ...ErrorResponses },
    },
  }, async(request) => {
    const body = request.body as { script?: unknown } | null
    if (body == null || typeof body.script !== 'string') throw new ApiError(400, 'SOURCE_INVALID_METADATA', 'A source script is required')
    const source = await service.installSource(body.script)
    events?.publishSnapshot('sources.updated', service.list())
    return { data: source }
  })
  app.post('/api/v1/sources/import', {
    schema: {
      operationId: 'importSourceFromUrl',
      tags: ['Sources'],
      summary: 'Import a source script from a network URL',
      body: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2048, pattern: '^https?://' }) }, { additionalProperties: false }),
      response: { 200: sourceResponse, ...ErrorResponses },
    },
  }, async(request) => {
    const body = request.body as { url?: unknown } | null
    if (body == null || typeof body.url !== 'string') throw new ApiError(400, 'SOURCE_INVALID_URL', 'A source URL is required')
    const source = await service.installSourceFromUrl(body.url)
    events?.publishSnapshot('sources.updated', service.list())
    return { data: source }
  })
  app.put('/api/v1/sources/active', {
    schema: {
      operationId: 'activateSource',
      tags: ['Sources'],
      summary: 'Select the active source',
      body: Type.Object({ sourceId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      response: { 200: sourceResponse, ...ErrorResponses },
    },
  }, async(request) => {
    const body = request.body as { sourceId?: unknown } | null
    if (body == null || typeof body.sourceId !== 'string' || body.sourceId.length === 0) throw new ApiError(400, 'SOURCE_NOT_FOUND', 'Source id is required')
    const source = await service.activate(body.sourceId)
    events?.publishSnapshot('sources.updated', service.list())
    return { data: source }
  })
  app.delete('/api/v1/sources/:id', {
    schema: {
      operationId: 'deleteSource',
      tags: ['Sources'],
      summary: 'Delete an installed source',
      params: IdParams,
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async(request, reply) => {
    await service.remove((request.params as { id: string }).id)
    events?.publishSnapshot('sources.updated', service.list())
    return reply.code(204).send()
  })
}
