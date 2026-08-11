import { createWriteStream, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDB } from '../db/core/db'
import { getAudioRoot, isPathInside } from '../config'
import { getExt, getMusicType, makeDirectoryName, makeFileName, reserveFileName } from './filenames'
import { applyDownloadMetadata } from './metadata'
import type { DownloadCreateInput, DownloadDto, DownloadJobRecord, DownloadStatus, ResolvedDownload } from './types'

interface DownloadManagerOptions {
  storageRoot: string
  getSettings: () => LX.AppSetting
  resolve: (job: DownloadJobRecord, signal: AbortSignal) => Promise<ResolvedDownload>
  publish?: (jobs: DownloadDto[]) => void
  metadata?: (filePath: string, job: DownloadJobRecord, settings: LX.AppSetting) => Promise<void>
  resolveListName?: (listId: string) => string | undefined
  finalizationCheckpoint?: (
    point: 'before-marker' | 'after-marker' | 'after-rename' | 'after-publication',
    job: DownloadJobRecord,
  ) => Promise<'simulate-crash' | undefined> | 'simulate-crash' | undefined
  removePart?: (partPath: string) => void
  onCompleted?: () => Promise<unknown> | unknown
  autoStart?: boolean
  now?: () => number
}

const TABLE = `CREATE TABLE IF NOT EXISTS web_downloads (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  record TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const statusValues = new Set<DownloadStatus>(['waiting', 'running', 'paused', 'error', 'completed'])

const normalizePersistedTrackId = (record: DownloadJobRecord): void => {
  const musicInfo = record.musicInfo as unknown as Record<string, unknown>
  if (typeof musicInfo.id === 'string' && musicInfo.id.length > 0) return
  if (typeof musicInfo.songmid === 'string' && musicInfo.songmid.length > 0) musicInfo.id = musicInfo.songmid
}

export class DownloadManager {
  private readonly records = new Map<string, DownloadJobRecord>()
  private readonly active = new Map<string, { controller: AbortController, promise: Promise<void> }>()
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private readonly audioRoot: string
  private closed = false

  constructor(private readonly options: DownloadManagerOptions) {
    this.audioRoot = getAudioRoot(options.storageRoot)
    mkdirSync(this.audioRoot, { recursive: true })
    if (!isPathInside(options.storageRoot, this.audioRoot)) throw new Error('Service audio root escaped storage root')
    mkdirSync(path.join(options.storageRoot, 'tmp'), { recursive: true })
    try {
      this.db = getDB()
      this.ownsDb = false
    } catch {
      this.db = new Database(path.join(options.storageRoot, 'lx.data.db'))
      this.db.pragma('journal_mode = WAL')
      this.ownsDb = true
    }
    this.db.exec(TABLE)
    let recoveredCompletion = false
    const rows = this.db.prepare('SELECT record FROM web_downloads ORDER BY created_at').all() as Array<{ record: string }>
    for (const row of rows) {
      const record = JSON.parse(row.record) as DownloadJobRecord
      if (!statusValues.has(record.status)) continue
      normalizePersistedTrackId(record)
      this.normalizeFinalPath(record)
      const final = this.resolveFinal(record.finalRelativePath)
      const part = this.resolveRelative(record.partRelativePath)
      if (record.status !== 'completed' && this.recoverPublication(record, final, part)) recoveredCompletion = true
      else if (record.status === 'running') record.status = 'paused'
      if (record.status === 'completed') {
        const recoveredFinal = this.resolveFinal(record.finalRelativePath)
        record.publication = undefined
        if (existsSync(recoveredFinal)) {
          record.downloaded = record.total = statSync(recoveredFinal).size
          record.finalMissing = undefined
        } else {
          record.status = 'error'
          record.error = 'Completed download file is missing'
          record.downloaded = 0
          record.finalMissing = true
        }
      } else if (record.partCleanupPending !== true) {
        record.downloaded = existsSync(part) ? statSync(part).size : 0
      }
      this.records.set(record.id, record)
      this.persist(record)
    }
    this.cleanupOrphanParts()
    this.publish()
    if (recoveredCompletion) queueMicrotask(() => { void Promise.resolve(this.options.onCompleted?.()).catch(() => {}) })
    if (options.autoStart !== false) queueMicrotask(() => { this.pump() })
  }

  list(): DownloadDto[] {
    let queuePosition = 0
    return [...this.records.values()].map(record => this.dto(record, record.status === 'waiting' ? ++queuePosition : null))
  }

  get(id: string): DownloadDto | undefined { return this.list().find(record => record.id === id) }

  async create(input: DownloadCreateInput): Promise<DownloadDto> {
    if (this.closed) throw new Error('Download manager is closed')
    const settings = this.options.getSettings()
    const quality = getMusicType(input.musicInfo, input.quality, input.qualityList)
    const extension = getExt(quality)
    const saveRoot = this.checkedSaveRoot()
    const listName = input.listId == null ? undefined : this.options.resolveListName?.(input.listId)
    const listDirectory = settings['download.isSavePathGroupByListName']
      ? makeDirectoryName(listName ?? 'Default')
      : ''
    const destination = path.join(saveRoot, listDirectory)
    mkdirSync(destination, { recursive: true })
    if (!isPathInside(this.options.storageRoot, destination)) throw new Error('Download destination escaped storage root')
    const reserved = this.reservedFileNames(destination)
    const requested = makeFileName(settings['download.fileName'], input.musicInfo.name, input.musicInfo.singer, extension)
    const fileName = reserveFileName(destination, requested, reserved)
    const baseId = `${input.musicInfo.id}_${quality}_${extension}`
    let id = baseId
    let duplicate = 0
    while (this.records.has(id)) id = `${baseId}_${++duplicate}`
    const now = this.now()
    const record: DownloadJobRecord = {
      id,
      status: 'waiting',
      musicInfo: input.musicInfo,
      quality,
      extension,
      fileName,
      finalRelativePath: this.relative(path.join(destination, fileName)),
      partRelativePath: this.relative(path.join(this.options.storageRoot, 'tmp', `${id}.part`)),
      downloaded: 0,
      total: 0,
      listId: input.listId,
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(id, record)
    this.persist(record)
    this.publish()
    if (this.options.autoStart !== false) this.pump()
    return this.get(id)!
  }

  async start(id: string): Promise<void> {
    const record = this.required(id)
    if (record.status === 'completed' || record.status === 'running') return
    if (record.partCleanupPending === true && !this.retryPartCleanup(record)) return
    if (record.finalMissing === true) this.update(record, { finalMissing: undefined })
    if (await this.finalizeCompletePart(record)) return
    this.ensureAvailableDestination(record)
    this.update(record, { status: 'waiting', error: undefined })
    this.pump()
  }

  async resume(id: string): Promise<void> { await this.start(id) }

  pause(id: string): void {
    const record = this.required(id)
    if (record.status === 'completed') return
    this.update(record, { status: 'paused' })
    this.active.get(id)?.controller.abort()
  }

  async remove(id: string): Promise<void> {
    const record = this.required(id)
    this.active.get(id)?.controller.abort()
    if (record.status !== 'completed') rmSync(this.resolveRelative(record.partRelativePath), { force: true })
    this.records.delete(id)
    this.db.prepare('DELETE FROM web_downloads WHERE id = ?').run(id)
    this.publish()
    this.pump()
  }

  async waitForIdle(): Promise<void> {
    while (this.active.size > 0 || [...this.records.values()].some(record => record.status === 'waiting' && this.options.autoStart !== false)) {
      const current = [...this.active.values()].map(async item => item.promise)
      if (current.length === 0) { this.pump(); await new Promise(resolve => setTimeout(resolve, 5)) } else await Promise.allSettled(current)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const { controller } of this.active.values()) controller.abort()
    if (this.ownsDb) this.db.close()
  }

  __setStateForTest(id: string, status: DownloadStatus, patch: Partial<DownloadJobRecord> = {}): void {
    this.update(this.required(id), { ...patch, status })
  }

  private pump(): void {
    if (this.closed) return
    const maximum = Math.max(1, Math.floor(Number(this.options.getSettings()['download.maxDownloadNum']) || 1))
    for (const record of this.records.values()) {
      if (this.active.size >= maximum) return
      if (record.status !== 'waiting') continue
      const controller = new AbortController()
      const promise = this.run(record, controller).finally(() => {
        this.active.delete(record.id)
        this.pump()
      })
      this.active.set(record.id, { controller, promise })
    }
  }

  private async run(record: DownloadJobRecord, controller: AbortController): Promise<void> {
    try {
      this.update(record, { status: 'running', error: undefined })
      const resolved = await this.options.resolve(record, controller.signal)
      await this.transfer(record, resolved, controller.signal, true)
      if (controller.signal.aborted || record.status === 'paused') return
      await this.finalize(record)
    } catch (error) {
      if (controller.signal.aborted || record.status === 'paused') return
      this.update(record, { status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async transfer(record: DownloadJobRecord, resolved: ResolvedDownload, signal: AbortSignal, allowResume: boolean): Promise<void> {
    const part = this.resolveRelative(record.partRelativePath)
    const existing = existsSync(part) ? statSync(part).size : 0
    const resume = allowResume && existing > 0 && (record.etag != null || record.lastModified != null)
    const headers = new Headers(resolved.headers)
    if (resume) {
      headers.set('range', `bytes=${existing}-`)
      headers.set('if-range', record.etag ?? record.lastModified!)
    }
    const response = await fetch(resolved.url, { headers, signal, redirect: 'follow' })
    if (!response.ok && response.status !== 206) throw new Error(`Download source returned HTTP ${response.status}`)
    const contentRange = response.headers.get('content-range')
    const validResume = resume && response.status === 206 && contentRange?.startsWith(`bytes ${existing}-`) === true
    if (resume && !validResume) {
      await response.body?.cancel()
      rmSync(part, { force: true })
      this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
      return this.transfer(record, resolved, signal, false)
    }
    const responseLength = Number(response.headers.get('content-length') ?? 0)
    const total = validResume ? existing + responseLength : responseLength
    this.update(record, {
      downloaded: validResume ? existing : 0,
      total: Number.isFinite(total) ? total : 0,
      etag: response.headers.get('etag') ?? record.etag,
      lastModified: response.headers.get('last-modified') ?? record.lastModified,
    })
    const writer = createWriteStream(part, { flags: validResume ? 'a' : 'w' })
    try {
      if (response.body == null) throw new Error('Download source returned no body')
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        if (!writer.write(Buffer.from(chunk))) await onceDrain(writer)
        record.downloaded += chunk.byteLength
        record.updatedAt = this.now()
        this.persist(record)
        this.publish()
      }
      await new Promise<void>((resolve, reject) => writer.end(error => { error == null ? resolve() : reject(error) }))
      if (record.total > 0 && record.downloaded !== record.total) throw new Error(`Incomplete download: ${record.downloaded}/${record.total}`)
    } catch (error) {
      writer.destroy()
      throw error
    }
  }

  private checkedSaveRoot(): string {
    mkdirSync(this.audioRoot, { recursive: true })
    if (!isPathInside(this.options.storageRoot, this.audioRoot)) throw new Error('Service audio root escaped storage root')
    return this.audioRoot
  }

  private recoverPublication(record: DownloadJobRecord, final: string, part: string): boolean {
    const marker = record.publication
    if (marker == null) return false
    if ((marker.phase !== 'prepared' && marker.phase !== 'published') ||
      !/^[a-f\d]{64}$/.test(marker.sha256) || !Number.isSafeInteger(marker.size) || marker.size < 0) {
      this.rejectPublication(record, part, 'Download publication marker is invalid')
      return false
    }
    try {
      if (marker.phase === 'published') {
        if (!existsSync(final) || !statSync(final).isFile()) throw new Error('Published download file is missing')
        this.completeRecovered(record, final)
        return true
      }
      if (existsSync(final) && statSync(final).isFile() && statSync(final).size === marker.size && sha256File(final) === marker.sha256) {
        try { this.removeRejectedPart(part) } catch {}
        this.completeRecovered(record, final)
        return true
      }
      if (existsSync(part) && statSync(part).isFile() && statSync(part).size === marker.size && sha256File(part) === marker.sha256) {
        this.ensureAvailableDestination(record)
        const recoveredFinal = this.resolveFinal(record.finalRelativePath)
        renameSync(part, recoveredFinal)
        fsyncDirectory(path.dirname(recoveredFinal))
        this.completeRecovered(record, recoveredFinal)
        return true
      }
      this.rejectPublication(record, part, 'Prepared download publication could not be recovered')
      return false
    } catch (error) {
      this.rejectPublication(record, part, error instanceof Error ? error.message : String(error))
      return false
    }
  }

  private rejectPublication(record: DownloadJobRecord, part: string, error: string): void {
    record.publication = undefined
    record.partCleanupPending = true
    record.status = 'error'
    record.downloaded = 0
    record.total = 0
    record.etag = undefined
    record.lastModified = undefined
    record.error = error
    record.updatedAt = this.now()
    this.persist(record)
    try {
      this.removeRejectedPart(part)
      record.partCleanupPending = undefined
      record.updatedAt = this.now()
      this.persist(record)
    } catch (cleanupError) {
      record.error = `${error}; part cleanup pending: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      record.updatedAt = this.now()
      this.persist(record)
    }
  }

  private retryPartCleanup(record: DownloadJobRecord): boolean {
    try {
      this.removeRejectedPart(this.resolveRelative(record.partRelativePath))
      this.update(record, { partCleanupPending: undefined })
      return true
    } catch (error) {
      this.update(record, {
        status: 'error',
        downloaded: 0,
        total: 0,
        error: `Part cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      return false
    }
  }

  private removeRejectedPart(part: string): void {
    const tempRoot = path.resolve(this.options.storageRoot, 'tmp')
    const resolved = path.resolve(part)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).endsWith('.part')) {
      throw new Error('Rejected part cleanup path escaped the Service temp root')
    }
    if (this.options.removePart != null) this.options.removePart(resolved)
    else rmSync(resolved, { recursive: true, force: true })
  }

  private completeRecovered(record: DownloadJobRecord, final: string): void {
    const size = statSync(final).size
    record.status = 'completed'
    record.downloaded = size
    record.total = size
    record.publication = undefined
    record.partCleanupPending = undefined
    record.error = undefined
  }

  private async finalizeCompletePart(record: DownloadJobRecord): Promise<boolean> {
    const part = this.resolveRelative(record.partRelativePath)
    if (!existsSync(part) || record.total <= 0 || record.downloaded !== record.total || statSync(part).size !== record.total) return false
    await this.finalize(record)
    return true
  }

  private async finalize(record: DownloadJobRecord): Promise<void> {
    const part = this.resolveRelative(record.partRelativePath)
    const descriptor = openSync(part, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    if (await this.options.finalizationCheckpoint?.('before-marker', record) === 'simulate-crash') return
    this.ensureAvailableDestination(record)
    const partSize = statSync(part).size
    this.update(record, { publication: { phase: 'prepared', size: partSize, sha256: sha256File(part) } })
    if (await this.options.finalizationCheckpoint?.('after-marker', record) === 'simulate-crash') return
    this.ensureAvailableDestination(record)
    const final = this.resolveFinal(record.finalRelativePath)
    renameSync(part, final)
    if (await this.options.finalizationCheckpoint?.('after-rename', record) === 'simulate-crash') return
    fsyncDirectory(path.dirname(final))
    this.update(record, { publication: { ...record.publication!, phase: 'published' } })
    if (await this.options.finalizationCheckpoint?.('after-publication', record) === 'simulate-crash') return
    let warning: string | undefined
    try {
      await (this.options.metadata ?? applyDownloadMetadata)(final, record, this.options.getSettings())
    } catch (error) {
      warning = `Metadata: ${error instanceof Error ? error.message : String(error)}`
    }
    const size = statSync(final).size
    this.update(record, { status: 'completed', downloaded: size, total: size, publication: undefined, finalMissing: undefined, warning })
    await this.options.onCompleted?.()
  }

  private ensureAvailableDestination(record: DownloadJobRecord): void {
    const current = this.resolveFinal(record.finalRelativePath)
    const directory = path.dirname(current)
    const reserved = this.reservedFileNames(directory, record.id)
    if (!existsSync(current) && !reserved.has(record.fileName)) return
    const fileName = reserveFileName(directory, record.fileName, reserved)
    record.fileName = fileName
    record.finalRelativePath = this.relative(path.join(directory, fileName))
    record.updatedAt = this.now()
    this.persist(record)
    this.publish()
  }

  private reservedFileNames(directory: string, excludedId?: string): Set<string> {
    return new Set([...this.records.values()]
      .filter(record => record.id !== excludedId && path.dirname(this.resolveFinal(record.finalRelativePath)) === directory)
      .filter(record => record.finalMissing !== true && (record.status !== 'completed' || existsSync(this.resolveFinal(record.finalRelativePath))))
      .map(record => record.fileName))
  }

  private relative(filePath: string): string {
    if (!isPathInside(this.options.storageRoot, filePath)) throw new Error('Path escaped storage root')
    return path.relative(this.options.storageRoot, filePath).split(path.sep).join('/')
  }

  private resolveRelative(relative: string): string {
    const resolved = path.resolve(this.options.storageRoot, relative)
    if (!isPathInside(this.options.storageRoot, resolved)) throw new Error('Stored path escaped storage root')
    return resolved
  }

  private resolveFinal(relative: string): string {
    const resolved = this.resolveRelative(relative)
    if (!isPathInside(this.audioRoot, resolved)) throw new Error('Stored download path escaped the Service audio root')
    return resolved
  }

  private normalizeFinalPath(record: DownloadJobRecord): void {
    const resolved = path.resolve(this.options.storageRoot, record.finalRelativePath)
    if (isPathInside(this.audioRoot, resolved)) return
    record.fileName = path.basename(record.fileName)
    record.finalRelativePath = this.relative(path.join(this.audioRoot, record.fileName))
  }

  private cleanupOrphanParts(): void {
    const referenced = new Set([...this.records.values()].map(record => path.basename(record.partRelativePath)))
    for (const name of readdirSync(path.join(this.options.storageRoot, 'tmp'))) {
      if (!name.endsWith('.part') || referenced.has(name)) continue
      try { this.removeRejectedPart(path.join(this.options.storageRoot, 'tmp', name)) } catch {}
    }
  }

  private required(id: string): DownloadJobRecord {
    const record = this.records.get(id)
    if (record == null) throw new Error(`Download not found: ${id}`)
    return record
  }

  private update(record: DownloadJobRecord, patch: Partial<DownloadJobRecord>): void {
    Object.assign(record, patch, { updatedAt: this.now() })
    this.persist(record)
    this.publish()
  }

  private persist(record: DownloadJobRecord): void {
    this.db.prepare(`INSERT INTO web_downloads (id, status, record, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, record=excluded.record, updated_at=excluded.updated_at`)
      .run(record.id, record.status, JSON.stringify(record), record.createdAt, record.updatedAt)
  }

  private publish(): void { this.options.publish?.(this.list()) }
  private now(): number { return this.options.now?.() ?? Date.now() }

  private dto(record: DownloadJobRecord, queuePosition: number | null): DownloadDto {
    return {
      id: record.id,
      status: record.status,
      musicInfo: record.musicInfo,
      quality: record.quality,
      extension: record.extension,
      fileName: record.fileName,
      downloaded: record.downloaded,
      total: record.total,
      progress: record.total > 0 ? Math.min(100, record.downloaded / record.total * 100) : 0,
      queuePosition,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      warning: record.warning,
      error: record.error,
      listId: record.listId,
    }
  }
}

const onceDrain = async(stream: NodeJS.WritableStream): Promise<void> => new Promise((resolve, reject) => {
  stream.once('drain', resolve)
  stream.once('error', reject)
})

const sha256File = (filePath: string): string => {
  const hash = createHash('sha256')
  const descriptor = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let length = 0
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length))
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
