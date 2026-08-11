import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { requestSourceNetwork, type SourceNetworkOptions } from './network'
import { SourceServiceError, type InstalledSource, type SearchResult, type SourceRequest, type SourceSummary } from './types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeout: ReturnType<typeof setTimeout>
  abort?: () => void
  signal?: AbortSignal
  request: SourceRequest
}

export interface SourceWorkerHostOptions {
  requestTimeoutMs?: number
  maxOutstanding?: number
  network?: SourceNetworkOptions
  onUpdateAlert?: (alert: { log: string, updateUrl?: string }) => void
}

export class SourceWorkerHost {
  private worker?: Worker
  private ready?: Promise<NonNullable<SourceSummary['sources']>>
  private readonly pending = new Map<number, PendingRequest>()
  private readonly requestQueue: number[] = []
  private readonly network = new Map<string, AbortController>()
  private activeRequestId?: number
  private capabilitiesValue?: NonNullable<SourceSummary['sources']>
  private sequence = 0
  private generation = 0
  private closed = false
  private readonly requestTimeoutMs: number
  private readonly maxOutstanding: number

  constructor(private readonly source: Pick<InstalledSource, 'id' | 'name' | 'description' | 'version' | 'author' | 'homepage'> & Partial<Pick<InstalledSource, 'scriptPath'>> & { script?: string }, private readonly options: SourceWorkerHostOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
    this.maxOutstanding = options.maxOutstanding ?? 16
  }

  private async start(): Promise<NonNullable<SourceSummary['sources']>> {
    if (this.ready != null) return this.ready
    const script = this.source.script ?? readFileSync(this.source.scriptPath!, 'utf8')
    this.ready = new Promise((resolve, reject) => {
      const jsPath = path.join(__dirname, 'worker.js')
      const workerPath = existsSync(jsPath) ? jsPath : path.resolve(process.cwd(), 'src/server/sources/worker.ts')
      const worker = this.worker = new Worker(workerPath, {
        workerData: { script, info: this.source },
        ...(workerPath.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : {}),
      })
      const generation = ++this.generation
      const isCurrent = () => this.worker === worker && this.generation === generation
      const initTimeout = setTimeout(() => {
        if (!isCurrent()) return
        this.reset(new SourceServiceError('SOURCE_TIMEOUT'))
        reject(new SourceServiceError('SOURCE_TIMEOUT'))
      }, this.requestTimeoutMs)
      worker.on('message', message => {
        if (!isCurrent()) return
        if (message?.type === 'initialized') {
          clearTimeout(initTimeout)
          try {
            const sources = this.normalizeSources(message.sources)
            this.capabilitiesValue = sources
            resolve(sources)
          } catch (error) {
            const protocolError = error instanceof SourceServiceError ? error : new SourceServiceError('SOURCE_PROTOCOL_ERROR')
            this.reset(protocolError)
            reject(protocolError)
          }
          return
        }
        if (message?.type === 'init-error') {
          clearTimeout(initTimeout)
          const error = new SourceServiceError('SOURCE_PROTOCOL_ERROR', message.message)
          this.reset(error)
          reject(error)
          return
        }
        void this.handleMessage(worker, generation, message)
      })
      worker.once('error', error => {
        if (!isCurrent()) return
        clearTimeout(initTimeout)
        const protocolError = new SourceServiceError('SOURCE_PROTOCOL_ERROR', error.message)
        this.reset(protocolError)
        reject(protocolError)
      })
      worker.once('exit', code => {
        if (isCurrent() && !this.closed && code !== 0) {
          clearTimeout(initTimeout)
          const protocolError = new SourceServiceError('SOURCE_PROTOCOL_ERROR')
          this.reset(protocolError)
          reject(protocolError)
        }
      })
    })
    return this.ready
  }

  private normalizeSources(value: unknown): NonNullable<SourceSummary['sources']> {
    if (typeof value !== 'object' || value == null || !('sources' in value) || typeof value.sources !== 'object' || value.sources == null) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR')
    const result: NonNullable<SourceSummary['sources']> = {}
    for (const [name, source] of Object.entries(value.sources as Record<string, unknown>)) {
      if (typeof source !== 'object' || source == null) continue
      const info = source as { type?: unknown, actions?: unknown, qualitys?: unknown }
      if (info.type !== 'music' || !Array.isArray(info.actions) || !Array.isArray(info.qualitys)) continue
      result[name] = { type: 'music', actions: info.actions.filter((action): action is 'musicUrl' | 'lyric' | 'pic' => action === 'musicUrl' || action === 'lyric' || action === 'pic'), qualitys: info.qualitys.filter((quality): quality is string => typeof quality === 'string') }
    }
    return result
  }

  private async handleMessage(worker: Worker, generation: number, message: any): Promise<void> {
    if (this.worker !== worker || this.generation !== generation) return
    if (message?.type === 'update-alert') {
      const data = message.data
      if (typeof data !== 'object' || data == null || typeof data.log !== 'string') return
      const updateUrl = typeof data.updateUrl === 'string' && data.updateUrl.length <= 1024 && /^https?:\/\/[^\s]+$/.test(data.updateUrl) ? data.updateUrl : undefined
      this.options.onUpdateAlert?.({ log: data.log.length > 1024 ? `${data.log.substring(0, 1024)}...` : data.log, ...(updateUrl == null ? {} : { updateUrl }) })
      return
    }
    if (message?.type === 'network') {
      const controller = new AbortController()
      const networkKey = `${generation}:${message.id}`
      this.network.set(networkKey, controller)
      try {
        const response = await requestSourceNetwork(String(message.url), message.options, controller.signal, this.options.network)
        if (this.worker === worker && this.generation === generation) worker.postMessage({ type: 'network-response', id: message.id, response: { statusCode: response.statusCode, statusMessage: response.statusMessage, headers: response.headers, raw: Array.from(response.raw), body: response.body }, body: response.body })
      } catch (error) {
        const sourceError = error instanceof SourceServiceError ? error : new SourceServiceError('SOURCE_PROTOCOL_ERROR')
        if (this.worker === worker && this.generation === generation) worker.postMessage({ type: 'network-response', id: message.id, error: { code: sourceError.code, message: sourceError.message } })
      } finally {
        if (this.generation === generation) this.network.delete(networkKey)
      }
      return
    }
    if (message?.type === 'network-cancel') {
      this.network.get(`${generation}:${message.id}`)?.abort()
      return
    }
    if (message?.type === 'response' || message?.type === 'response-error') {
      // The VM may only settle the invocation currently dispatched to this
      // worker generation. Ignore stale, duplicate, and queued/future IDs.
      if (message.id !== this.activeRequestId) return
      const pending = this.pending.get(message.id)
      if (pending == null) return
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abort!)
      if (message.type === 'response') {
        try {
          pending.resolve(this.normalizeActionResult(pending.request, message.result))
          this.completeRequest(message.id)
        } catch (error) {
          const protocolError = error instanceof SourceServiceError ? error : new SourceServiceError('SOURCE_PROTOCOL_ERROR')
          this.reset(protocolError)
          pending.reject(protocolError)
        }
      } else {
        const error = new SourceServiceError(typeof message.code === 'string' ? message.code : 'SOURCE_PROTOCOL_ERROR', message.message)
        if (error.code === 'SOURCE_PROTOCOL_ERROR') this.reset(error)
        else this.completeRequest(message.id)
        pending.reject(error)
      }
    }
  }

  private completeRequest(id: number): void {
    if (this.activeRequestId === id) this.activeRequestId = undefined
    this.dispatchNext()
  }

  private dispatchNext(): void {
    if (this.worker == null || this.activeRequestId != null) return
    while (this.requestQueue.length > 0) {
      const id = this.requestQueue.shift()!
      const pending = this.pending.get(id)
      if (pending == null) continue
      this.activeRequestId = id
      this.worker.postMessage({ type: 'request', id, request: pending.request, entropy: Array.from(randomBytes(64 * 1024)) })
      return
    }
  }

  private reset(reason: SourceServiceError): void {
    const worker = this.worker
    this.worker = undefined
    this.ready = undefined
    if (worker != null) void worker.terminate()
    for (const controller of this.network.values()) controller.abort()
    this.network.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abort!)
      pending.reject(reason)
    }
    this.pending.clear()
    this.requestQueue.length = 0
    this.activeRequestId = undefined
    this.capabilitiesValue = undefined
  }

  async capabilities(): Promise<NonNullable<SourceSummary['sources']>> {
    return this.start()
  }

  async request<T>(request: SourceRequest, signal?: AbortSignal): Promise<T> {
    await this.start()
    if (this.pending.size >= this.maxOutstanding) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Too many outstanding source requests')
    if (signal?.aborted) throw new SourceServiceError('SOURCE_CANCELLED')
    const sources = this.capabilitiesValue ?? {}
    const supported = sources[request.source]
    if (supported == null || !supported.actions.includes(request.action as 'musicUrl' | 'lyric' | 'pic')) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Unsupported source action')
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { this.reset(new SourceServiceError('SOURCE_TIMEOUT')) }, this.requestTimeoutMs)
      const abort = () => {
        const pending = this.pending.get(id)
        if (pending == null) return
        this.pending.delete(id)
        clearTimeout(pending.timeout)
        this.reset(new SourceServiceError('SOURCE_CANCELLED'))
        reject(new SourceServiceError('SOURCE_CANCELLED'))
      }
      this.pending.set(id, { resolve: value => { resolve(value as T) }, reject, timeout, abort, signal, request })
      signal?.addEventListener('abort', abort, { once: true })
      this.requestQueue.push(id)
      this.dispatchNext()
    })
  }

  private normalizeActionResult(request: SourceRequest | undefined, value: unknown): unknown {
    switch (request?.action) {
      case 'musicUrl':
      {
        const url = typeof value === 'string' ? value : value != null && typeof value === 'object' ? (value as { url?: unknown }).url : undefined
        if (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//.test(url)) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Invalid music URL response')
        const rawHeaders = value != null && typeof value === 'object' ? (value as { headers?: unknown }).headers : undefined
        const headers = rawHeaders != null && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)
          ? Object.fromEntries(Object.entries(rawHeaders).filter(([name, headerValue]) => typeof headerValue === 'string' && name.length <= 128 && !/[\r\n]/.test(name) && headerValue.length <= 8192 && !/[\r\n]/.test(headerValue)))
          : undefined
        return { url, ...(headers == null ? {} : { headers }) }
      }
      case 'pic':
        if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//.test(value)) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Invalid picture response')
        return value
      case 'lyric': {
        if (typeof value !== 'object' || value == null || typeof (value as { lyric?: unknown }).lyric !== 'string') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Invalid lyric response')
        const lyric = value as Record<string, unknown>
        if ((lyric.lyric as string).length > 51_200) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Invalid lyric response')
        return {
          lyric: lyric.lyric,
          tlyric: typeof lyric.tlyric === 'string' && lyric.tlyric.length < 5_120 ? lyric.tlyric : null,
          rlyric: typeof lyric.rlyric === 'string' && lyric.rlyric.length < 5_120 ? lyric.rlyric : null,
          lxlyric: typeof lyric.lxlyric === 'string' && lyric.lxlyric.length < 8_192 ? lyric.lxlyric : null,
        }
      }
      default: throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Unsupported source action')
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.reset(new SourceServiceError('SOURCE_PROTOCOL_ERROR'))
  }

  static normalizeSearchResult(value: unknown): SearchResult {
    if (typeof value !== 'object' || value == null) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR')
    const result = value as Partial<SearchResult>
    if (!Array.isArray(result.list) || typeof result.source !== 'string') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR')
    const list = result.list.map(item => {
      const music = item != null && typeof item === 'object' ? item : {}
      const qualityTypes = typeof music._types === 'object' && music._types != null && !Array.isArray(music._types) ? music._types : {}
      const originalMeta = music.meta != null && typeof music.meta === 'object' && !Array.isArray(music.meta) ? music.meta as Record<string, unknown> : {}
      const qualitys = Array.isArray(music.types) ? music.types : Array.isArray(originalMeta.qualitys) ? originalMeta.qualitys : []
      const id = String(music.id ?? '')
      const songmid = String(music.songmid ?? '')
      const stableId = id.length > 0 ? id : songmid
      return {
        ...music,
        id: id.length > 0 ? id : stableId,
        songmid: songmid.length > 0 ? songmid : stableId,
        name: String(music.name ?? ''),
        singer: String(music.singer ?? ''),
        source: typeof music.source === 'string' ? music.source : result.source,
        interval: typeof music.interval === 'string' ? music.interval : `${String(Math.floor(Number(music.interval ?? 0) / 60)).padStart(2, '0')}:${String(Math.floor(Number(music.interval ?? 0) % 60)).padStart(2, '0')}`,
        _types: qualityTypes,
        types: qualitys,
        meta: { ...originalMeta, _qualitys: typeof originalMeta._qualitys === 'object' && originalMeta._qualitys != null && !Array.isArray(originalMeta._qualitys) ? originalMeta._qualitys : qualityTypes, qualitys },
      }
    })
    if (list.some(item => item.id.length === 0)) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Search result is missing a track id')
    return { list, total: Number(result.total ?? list.length), limit: Number(result.limit ?? list.length), page: Number(result.page ?? 1), source: result.source }
  }
}
