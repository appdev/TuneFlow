import { constants, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDB } from '../db/core/db'
import { getAudioRoot, isPathInside } from '../config'
import { QUALITYS } from '../../common/constants'
import { getExt, getMusicTypes, makeDirectoryName, makeFileName, reserveFileName } from './filenames'
import { applyDownloadMetadata } from './metadata'
import type { DownloadCreateInput, DownloadDto, DownloadFileIntegrity, DownloadJobRecord, DownloadStatus, ResolvedDownload } from './types'
import { isSameMusic } from './matching'
import { migrateLegacyDatabaseFiles } from '../db/databasePath'
import defaultSetting from '../../common/defaultSetting'
import { parseFile } from 'music-metadata'
import { SourceServiceError } from '../sources/types'
import { MediaClient } from '../playback/mediaClient'
import { ApiError } from '../errors'
import { ReplacementPublisher } from './replacementPublisher'
import { normalizeMusicInfo } from '../sources/musicInfo'

export interface DownloadRoots {
  mode: 'split' | 'legacy'
  databaseRoot: string
  mediaRoot: string
  tempRoot: string
}

interface DownloadManagerOptions {
  roots?: DownloadRoots
  storageRoot?: string
  getSettings: () => TuneFlow.AppSetting
  resolve: (job: DownloadJobRecord, signal: AbortSignal) => Promise<ResolvedDownload>
  findExistingFile?: (musicInfo: TuneFlow.Music.MusicInfoOnline) => Promise<string | undefined>
  publish?: (jobs: DownloadDto[]) => void
  metadata?: (filePath: string, job: DownloadJobRecord, settings: TuneFlow.AppSetting, resources?: ResolvedDownload['resources'], lyricFilePath?: string) => Promise<unknown>
  materializeResources?: (filePath: string) => Promise<void>
  resolveListName?: (listId: string) => string | undefined
  finalizationCheckpoint?: (
    point: 'before-marker' | 'after-marker' | 'after-rename' | 'after-publication',
    job: DownloadJobRecord,
  ) => Promise<'simulate-crash' | undefined> | 'simulate-crash' | undefined
  removePart?: (partPath: string) => void
  onCompleted?: (filePath: string, job: DownloadJobRecord) => Promise<unknown> | unknown
  autoStart?: boolean
  now?: () => number
  mediaClient?: MediaClient
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
  record.musicInfo = normalizeMusicInfo(record.musicInfo) as TuneFlow.Music.MusicInfoOnline
  const musicInfo = record.musicInfo as unknown as Record<string, unknown>
  if (typeof musicInfo.id === 'string' && musicInfo.id.length > 0) return
  if (typeof musicInfo.songmid === 'string' && musicInfo.songmid.length > 0) musicInfo.id = musicInfo.songmid
}

export class DownloadManager {
  private readonly records = new Map<string, DownloadJobRecord>()
  private readonly active = new Map<string, { controller: AbortController, promise: Promise<void> }>()
  private readonly playbackCreations = new Map<string, Promise<DownloadDto>>()
  private readonly resolvedResources = new Map<string, ResolvedDownload['resources']>()
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private readonly audioRoot: string
  private readonly tempRoot: string
  private readonly roots: DownloadRoots
  private readonly mediaClient: MediaClient
  private readonly replacementPublisher = new ReplacementPublisher()
  private closed = false

  constructor(private readonly options: DownloadManagerOptions) {
    if (options.roots == null && options.storageRoot == null) throw new Error('Download storage roots are required')
    const legacyRoot = options.storageRoot == null ? undefined : path.resolve(options.storageRoot)
    this.roots = options.roots ?? {
      mode: 'legacy',
      databaseRoot: legacyRoot!,
      mediaRoot: getAudioRoot(legacyRoot!),
      tempRoot: path.join(legacyRoot!, 'tmp'),
    }
    this.mediaClient = options.mediaClient ?? new MediaClient({ allowPrivateNetwork: process.env.NODE_ENV === 'test' })
    this.audioRoot = this.roots.mediaRoot
    this.tempRoot = this.roots.tempRoot
    mkdirSync(this.audioRoot, { recursive: true })
    mkdirSync(this.tempRoot, { recursive: true })
    if (!isPathInside(this.audioRoot, this.audioRoot)) throw new Error('Service audio root is unavailable')
    try {
      this.db = getDB()
      this.ownsDb = false
    } catch {
      this.db = new Database(migrateLegacyDatabaseFiles(this.roots.databaseRoot))
      this.db.pragma('journal_mode = WAL')
      this.ownsDb = true
    }
    this.db.exec(TABLE)
    const recoveredCompletions: DownloadJobRecord[] = []
    const rows = this.db.prepare('SELECT record FROM web_downloads ORDER BY created_at').all() as Array<{ record: string }>
    for (const row of rows) {
      const record = JSON.parse(row.record) as DownloadJobRecord
      if (!statusValues.has(record.status)) continue
      normalizePersistedTrackId(record)
      this.normalizeFinalPath(record)
      const final = this.resolveFinal(record.finalRelativePath)
      const part = this.resolveTemp(record.partRelativePath)
      let recoveredCompletion = record.metadataPatch != null && this.recoverMetadataPatch(record, final)
      if (record.status !== 'completed' && record.replacement != null && record.replacement.phase !== 'downloading' && this.recoverReplacement(record)) recoveredCompletion = true
      else if (record.status !== 'completed' && this.recoverPublication(record, final, part)) recoveredCompletion = true
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
      if (recoveredCompletion) recoveredCompletions.push(record)
    }
    this.cleanupOrphanParts()
    this.cleanupOrphanMediaStages()
    this.publish()
    if (recoveredCompletions.length > 0) {
      queueMicrotask(() => {
        for (const record of recoveredCompletions) {
          void Promise.resolve(this.options.onCompleted?.(this.resolveFinal(record.finalRelativePath), record)).catch(() => {})
        }
      })
    }
    if (options.autoStart !== false) queueMicrotask(() => { this.pump() })
  }

  list(): DownloadDto[] {
    let queuePosition = 0
    return [...this.records.values()].map(record => this.dto(record, record.status === 'waiting' ? ++queuePosition : null))
  }

  get(id: string): DownloadDto | undefined { return this.list().find(record => record.id === id) }

  expectedIntegrity(filePath: string): DownloadFileIntegrity | undefined {
    let resolved: string
    try { resolved = realpathSync(filePath) } catch { return undefined }
    if (!isPathInside(this.audioRoot, resolved)) return undefined
    return [...this.records.values()].find(record =>
      record.status === 'completed' && existsSync(this.resolveFinal(record.finalRelativePath)) &&
        realpathSync(this.resolveFinal(record.finalRelativePath)) === resolved,
    )?.finalIntegrity
  }

  completedAt(filePath: string): number | undefined {
    let resolved: string
    try { resolved = realpathSync(filePath) } catch { return undefined }
    if (!isPathInside(this.audioRoot, resolved)) return undefined
    const timestamps = [...this.records.values()]
      .filter(record => record.status === 'completed' && existsSync(this.resolveFinal(record.finalRelativePath)) &&
        realpathSync(this.resolveFinal(record.finalRelativePath)) === resolved)
      .map(record => record.updatedAt)
    return timestamps.length === 0 ? undefined : Math.max(...timestamps)
  }

  attachResolvedResources(musicInfo: TuneFlow.Music.MusicInfoOnline, resources: NonNullable<ResolvedDownload['resources']>): number {
    let attached = 0
    for (const record of this.records.values()) {
      if (record.status === 'completed' || record.status === 'error' || !isSameMusic(record.musicInfo, musicInfo)) continue
      this.resolvedResources.set(record.id, this.mergeResources(this.resolvedResources.get(record.id), resources))
      attached++
    }
    return attached
  }

  publishMetadataPatch(input: {
    targetPath: string
    stagedPath: string
    originalIntegrity: DownloadFileIntegrity
    replacementIntegrity: DownloadFileIntegrity
  }): boolean {
    const target = realpathSync(input.targetPath)
    const staged = realpathSync(input.stagedPath)
    if (!isPathInside(this.audioRoot, target) || !isPathInside(this.audioRoot, staged) ||
      path.dirname(target) !== path.dirname(staged) || !path.basename(staged).endsWith('.tuneflowtmp')) {
      throw new Error('Metadata patch path escaped its managed audio directory')
    }
    const record = [...this.records.values()].reverse().find(candidate =>
      candidate.status === 'completed' && existsSync(this.resolveFinal(candidate.finalRelativePath)) &&
      realpathSync(this.resolveFinal(candidate.finalRelativePath)) === target,
    )
    if (record == null) return false
    this.requireIntegrity(target, input.originalIntegrity, 'Metadata patch target changed')
    this.requireIntegrity(staged, input.replacementIntegrity, 'Metadata patch staging integrity mismatch')
    this.update(record, {
      metadataPatch: {
        stagedRelativePath: this.mediaRelative(staged),
        originalIntegrity: input.originalIntegrity,
        replacementIntegrity: input.replacementIntegrity,
      },
    })
    renameSync(staged, target)
    fsyncDirectory(path.dirname(target))
    this.update(record, {
      downloaded: input.replacementIntegrity.size,
      total: input.replacementIntegrity.size,
      finalIntegrity: input.replacementIntegrity,
      metadataPatch: undefined,
    })
    return true
  }

  async createForPlayback(musicInfo: TuneFlow.Music.MusicInfoOnline): Promise<DownloadDto> {
    const key = `${musicInfo.source}\0${musicInfo.id}`
    const pending = this.playbackCreations.get(key)
    if (pending != null) return pending
    const creation = this.schedulePlaybackDownload(musicInfo).finally(() => {
      if (this.playbackCreations.get(key) === creation) this.playbackCreations.delete(key)
    })
    this.playbackCreations.set(key, creation)
    return creation
  }

  private async schedulePlaybackDownload(musicInfo: TuneFlow.Music.MusicInfoOnline): Promise<DownloadDto> {
    const reusable = [...this.records.values()].reverse().find(record =>
      record.status !== 'completed' && isSameMusic(record.musicInfo, musicInfo),
    )
    if (reusable != null) {
      if (reusable.status === 'error') await this.start(reusable.id)
      return this.get(reusable.id)!
    }
    return this.createInternal({
      musicInfo,
      quality: QUALITYS[0],
      qualityPolicy: 'highest',
      skipExisting: true,
      existingFilePolicy: 'reuse',
    }, !this.options.getSettings()['download.enable'])
  }

  async create(input: DownloadCreateInput): Promise<DownloadDto> {
    return this.createInternal(input, false)
  }

  private async createInternal(input: DownloadCreateInput, useDefaultDownloadSettings: boolean): Promise<DownloadDto> {
    if (this.closed) throw new Error('Download manager is closed')
    input = { ...input, musicInfo: normalizeMusicInfo(input.musicInfo) as TuneFlow.Music.MusicInfoOnline }
    const settings = this.effectiveSettings(useDefaultDownloadSettings)
    const requestedQuality = input.qualityPolicy === 'highest' ? QUALITYS[0] : input.quality
    const qualityCandidates = getMusicTypes(input.musicInfo, requestedQuality, input.qualityList)
    const quality = qualityCandidates[0]
    const extension = getExt(quality)
    const existingFilePolicy = input.existingFilePolicy ?? ([input.skipExisting, settings['download.skipExistFile']].includes(true) ? 'reuse' : 'duplicate')
    if (existingFilePolicy !== 'duplicate') {
      const active = [...this.records.values()].find(record =>
        record.status !== 'error' && record.status !== 'completed' && isSameMusic(record.musicInfo, input.musicInfo),
      )
      if (active != null) {
        if (existingFilePolicy === 'error') throw new ApiError(409, 'DOWNLOAD_ALREADY_EXISTS', 'Download already exists', { fileName: active.fileName, extension: active.extension })
        return this.get(active.id)!
      }
      const existingFile = await this.options.findExistingFile?.(input.musicInfo)
      if (existingFile != null) {
        if (existingFilePolicy === 'error') {
          throw new ApiError(409, 'DOWNLOAD_ALREADY_EXISTS', 'Download already exists', {
            fileName: path.basename(existingFile),
            extension: path.extname(existingFile).slice(1).toLowerCase(),
          })
        }
        if (existingFilePolicy === 'reuse') return this.adoptExistingFile(input, existingFile, qualityCandidates, useDefaultDownloadSettings)
        return this.createReplacement(input, existingFile, qualityCandidates, quality, extension, useDefaultDownloadSettings)
      }
    }
    const saveRoot = this.checkedSaveRoot()
    const listName = input.listId == null ? undefined : this.options.resolveListName?.(input.listId)
    const listDirectory = settings['download.isSavePathGroupByListName']
      ? makeDirectoryName(listName ?? 'Default')
      : ''
    const destination = path.join(saveRoot, listDirectory)
    mkdirSync(destination, { recursive: true })
    if (!isPathInside(this.audioRoot, destination)) throw new Error('Download destination escaped media root')
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
      qualityCandidates,
      extension,
      fileName,
      finalRelativePath: this.mediaRelative(path.join(destination, fileName)),
      partRelativePath: this.tempRelative(path.join(this.tempRoot, `${id}.part`)),
      downloaded: 0,
      total: 0,
      useDefaultDownloadSettings: useDefaultDownloadSettings || undefined,
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
    if (record.status === 'error' && record.qualityCandidates?.[0] != null) this.prepareQuality(record, record.qualityCandidates[0])
    if (record.finalMissing === true) this.update(record, { finalMissing: undefined })
    if (await this.finalizeCompletePart(record)) return
    if (record.replacement == null) this.ensureAvailableDestination(record)
    this.update(record, { status: 'waiting', error: undefined })
    this.pump()
  }

  async resume(id: string): Promise<void> { await this.start(id) }

  pause(id: string): void {
    const record = this.required(id)
    if (record.status === 'completed') return
    if (record.replacement != null && record.replacement.phase !== 'downloading') return
    this.update(record, { status: 'paused' })
    this.active.get(id)?.controller.abort()
  }

  async remove(id: string): Promise<void> {
    let record = this.required(id)
    if (record.replacement != null && record.replacement.phase !== 'downloading' && record.status !== 'completed') {
      await this.active.get(id)?.promise
      record = this.required(id)
    }
    this.active.get(id)?.controller.abort()
    if (record.status !== 'completed') {
      const part = this.resolveTemp(record.partRelativePath)
      rmSync(part, { force: true })
      rmSync(part + '.lrc', { force: true })
    }
    this.records.delete(id)
    this.db.prepare('DELETE FROM web_downloads WHERE id = ?').run(id)
    this.publish()
    this.pump()
  }

  clearHistory(): number {
    const history = [...this.records.values()].filter(record =>
      record.status === 'completed' || record.status === 'error',
    )
    if (history.length === 0) return 0

    for (const record of history) {
      if (record.status !== 'error') continue
      const part = this.resolveTemp(record.partRelativePath)
      rmSync(part, { force: true })
      rmSync(part + '.lrc', { force: true })
    }

    const remove = this.db.prepare('DELETE FROM web_downloads WHERE id = ?')
    const transaction = this.db.transaction((records: DownloadJobRecord[]) => {
      for (const record of records) remove.run(record.id)
    })
    transaction(history)
    for (const record of history) {
      this.records.delete(record.id)
      this.resolvedResources.delete(record.id)
    }
    this.publish()
    return history.length
  }

  removeCompletedForFile(filePath: string): number {
    const resolved = path.resolve(filePath)
    if (!isPathInside(this.audioRoot, resolved)) throw new Error('Completed download path escaped the Service audio root')
    const ids = [...this.records.values()]
      .filter(record => record.status === 'completed' && this.resolveFinal(record.finalRelativePath) === resolved)
      .map(record => record.id)
    if (ids.length === 0) return 0
    const remove = this.db.prepare('DELETE FROM web_downloads WHERE id = ?')
    const transaction = this.db.transaction((values: string[]) => {
      for (const id of values) remove.run(id)
    })
    transaction(ids)
    for (const id of ids) this.records.delete(id)
    this.publish()
    return ids.length
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
    const usesPlaybackDefaults = [...this.records.values()].some(record =>
      (record.status === 'waiting' || record.status === 'running') && record.useDefaultDownloadSettings === true,
    )
    const maximum = Math.max(1, Math.floor(Number(this.effectiveSettings(usesPlaybackDefaults)['download.maxDownloadNum']) || 1))
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
      const candidates = record.qualityCandidates ?? [record.quality]
      const currentIndex = Math.max(0, candidates.indexOf(record.quality))
      let transferred = false
      let lastError: unknown
      for (const quality of candidates.slice(currentIndex)) {
        if (controller.signal.aborted || record.status === 'paused') return
        const allowResume = quality === record.quality
        this.prepareQuality(record, quality)
        try {
          const resolved = await this.options.resolve(record, controller.signal)
          const sourceCandidates = resolved.candidates ?? (resolved.url == null ? [] : [{ sourceId: 'legacy', url: resolved.url, headers: resolved.headers }])
          let candidateError: unknown
          for (const [candidateIndex, candidate] of sourceCandidates.entries()) {
            if (controller.signal.aborted || record.status === 'paused') return
            try {
              await this.transfer(record, candidate, controller.signal, resolved.candidates == null && allowResume && candidateIndex === 0)
              if (resolved.candidates != null || record.replacement != null) await this.requireParseableAudio(record)
              this.resolvedResources.set(record.id, this.mergeResources(
                this.resolvedResources.get(record.id),
                candidate.resources ?? resolved.resources,
              ))
              transferred = true
              break
            } catch (error) {
              if (controller.signal.aborted || record.status === 'paused') return
              if (error instanceof SourceServiceError && error.origin !== 'service-network') throw error
              candidateError = error
              rmSync(this.resolveTemp(record.partRelativePath), { force: true })
              this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
            }
          }
          if (transferred) break
          if (candidateError instanceof Error) throw candidateError
          if (candidateError != null) throw new Error(String(candidateError))
          throw new Error('No download source candidate is available')
        } catch (error) {
          if (controller.signal.aborted || record.status === 'paused') return
          lastError = error
          rmSync(this.resolveTemp(record.partRelativePath), { force: true })
          this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
        }
      }
      if (!transferred) {
        if (lastError instanceof Error) throw lastError
        throw new Error(lastError == null ? 'No downloadable audio quality is available' : String(lastError))
      }
      await this.finalize(record)
    } catch (error) {
      if (!this.records.has(record.id)) return
      if (controller.signal.aborted || record.status === 'paused') return
      this.update(record, { status: 'error', error: error instanceof Error ? error.message : String(error) })
      this.resolvedResources.delete(record.id)
    }
  }

  private async transfer(record: DownloadJobRecord, resolved: ResolvedDownload, signal: AbortSignal, allowResume: boolean): Promise<void> {
    const part = this.resolveTemp(record.partRelativePath)
    const existing = existsSync(part) ? statSync(part).size : 0
    const resume = allowResume && existing > 0 && (record.etag != null || record.lastModified != null)
    const response = await this.mediaClient.open({ url: resolved.url, headers: resolved.headers }, {
      method: 'GET',
      range: resume ? `bytes=${existing}-` : undefined,
      ifRange: resume ? record.etag ?? record.lastModified : undefined,
      signal,
    })
    if (response.statusCode !== 200 && response.statusCode !== 206) {
      const retryable = [401, 403, 404, 408, 410, 429].includes(response.statusCode) || response.statusCode >= 500
      response.close()
      throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', `Download source returned HTTP ${response.statusCode}`, retryable ? 'service-network' : 'protocol')
    }
    const contentRange = response.headers['content-range']
    const parsedRange = contentRange == null ? null : /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)
    const rangeStart = parsedRange == null ? -1 : Number(parsedRange[1])
    const rangeEnd = parsedRange == null ? -1 : Number(parsedRange[2])
    const rangeTotal = parsedRange == null ? -1 : Number(parsedRange[3])
    const responseLength = response.headers['content-length'] == null ? 0 : Number(response.headers['content-length'])
    const rangeConsistent = parsedRange != null && rangeStart <= rangeEnd && rangeEnd < rangeTotal && (!Number.isFinite(responseLength) || responseLength === 0 || responseLength === rangeEnd - rangeStart + 1)
    const validResume = resume && response.statusCode === 206 && rangeConsistent && rangeStart === existing
    if (resume && !validResume) {
      response.close()
      rmSync(part, { force: true })
      this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
      return this.transfer(record, resolved, signal, false)
    }
    if (!resume && response.statusCode === 206 && (!rangeConsistent || rangeStart !== 0)) {
      response.close()
      throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Download range response is invalid', 'service-network')
    }
    const total = response.statusCode === 206 && rangeConsistent ? rangeTotal : responseLength
    this.update(record, {
      downloaded: validResume ? existing : 0,
      total: Number.isFinite(total) ? total : 0,
      etag: response.headers.etag ?? record.etag,
      lastModified: response.headers['last-modified'] ?? record.lastModified,
    })
    const writer = createWriteStream(part, { flags: validResume ? 'a' : 'w' })
    try {
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        if (!writer.write(Buffer.from(chunk))) await onceDrain(writer)
        record.downloaded += chunk.byteLength
        record.updatedAt = this.now()
        this.persist(record)
        this.publish()
      }
      await new Promise<void>((resolve, reject) => writer.end(error => { error == null ? resolve() : reject(error) }))
      if (record.total > 0 && record.downloaded !== record.total) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', `Incomplete download: ${record.downloaded}/${record.total}`, 'service-network')
    } catch (error) {
      writer.destroy()
      throw error
    } finally {
      response.close()
    }
  }

  private async requireParseableAudio(record: DownloadJobRecord): Promise<void> {
    try {
      const metadata = await parseFile(this.resolveTemp(record.partRelativePath), { duration: false, skipCovers: true })
      if (metadata.format.container == null || metadata.format.container === '' || metadata.format.codec == null || metadata.format.codec === '') {
        throw new Error('Audio container or codec is missing')
      }
    } catch {
      throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Downloaded audio is not parseable', 'service-network')
    }
  }

  private checkedSaveRoot(): string {
    mkdirSync(this.audioRoot, { recursive: true })
    if (!isPathInside(this.audioRoot, this.audioRoot)) throw new Error('Service audio root is unavailable')
    return this.audioRoot
  }

  private adoptExistingFile(
    input: DownloadCreateInput,
    filePath: string,
    qualityCandidates: TuneFlow.Quality[],
    useDefaultDownloadSettings: boolean,
  ): DownloadDto {
    const resolved = path.resolve(filePath)
    if (!isPathInside(this.audioRoot, resolved) || !existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new Error('Existing download candidate is unavailable')
    }
    const extension = path.extname(resolved).slice(1).toLowerCase() as DownloadJobRecord['extension']
    if (!['ape', 'flac', 'wav', 'mp3'].includes(extension)) throw new Error('Existing download candidate has an unsupported extension')
    const previous = [...this.records.values()].reverse().find(record =>
      record.status === 'completed' && isSameMusic(record.musicInfo, input.musicInfo),
    )
    const adoptedQuality: TuneFlow.Quality = previous != null && getExt(previous.quality) === extension
      ? previous.quality
      : extension === 'ape' ? 'ape' : extension === 'flac' ? 'flac' : extension === 'wav' ? 'wav' : '128k'
    const size = statSync(resolved).size
    const finalIntegrity = { size, sha256: sha256File(resolved) }
    if (previous != null) {
      this.update(previous, {
        musicInfo: input.musicInfo,
        quality: adoptedQuality,
        qualityCandidates,
        extension,
        fileName: path.basename(resolved),
        finalRelativePath: this.mediaRelative(resolved),
        downloaded: size,
        total: size,
        finalIntegrity,
        useDefaultDownloadSettings: useDefaultDownloadSettings || undefined,
        finalMissing: undefined,
        error: undefined,
      })
      return this.get(previous.id)!
    }

    const baseId = `${input.musicInfo.id}_${adoptedQuality}_${extension}`
    let id = baseId
    let duplicate = 0
    while (this.records.has(id)) id = `${baseId}_${++duplicate}`
    const now = this.now()
    const record: DownloadJobRecord = {
      id,
      status: 'completed',
      musicInfo: input.musicInfo,
      quality: adoptedQuality,
      qualityCandidates,
      extension,
      fileName: path.basename(resolved),
      finalRelativePath: this.mediaRelative(resolved),
      partRelativePath: this.tempRelative(path.join(this.tempRoot, `${id}.part`)),
      downloaded: size,
      total: size,
      finalIntegrity,
      useDefaultDownloadSettings: useDefaultDownloadSettings || undefined,
      listId: input.listId,
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(id, record)
    this.persist(record)
    this.publish()
    return this.get(id)!
  }

  private createReplacement(
    input: DownloadCreateInput,
    filePath: string,
    qualityCandidates: TuneFlow.Quality[],
    quality: TuneFlow.Quality,
    extension: DownloadJobRecord['extension'],
    useDefaultDownloadSettings: boolean,
  ): DownloadDto {
    const original = realpathSync(filePath)
    if (!isPathInside(this.audioRoot, original) || !statSync(original).isFile()) throw new Error('Existing download candidate is unavailable')
    const originalSize = statSync(original).size
    const currentIntegrity = { size: originalSize, sha256: sha256File(original) }
    const active = [...this.records.values()].find(record => record.replacement != null && record.status !== 'completed' && record.status !== 'error' &&
      this.resolveMedia(record.replacement.originalRelativePath) === original && isSameMusic(record.musicInfo, input.musicInfo))
    if (active != null) {
      if (active.replacement!.originalIntegrity.size === currentIntegrity.size && active.replacement!.originalIntegrity.sha256 === currentIntegrity.sha256) return this.get(active.id)!
      this.active.get(active.id)?.controller.abort()
      this.update(active, { status: 'error', error: 'DOWNLOAD_REPLACEMENT_CONFLICT' })
    }
    const originalExtension = path.extname(original).slice(1).toLowerCase()
    if (!['ape', 'flac', 'wav', 'mp3'].includes(originalExtension)) throw new Error('Existing download candidate has an unsupported extension')
    const directory = path.dirname(original)
    const settings = this.effectiveSettings(useDefaultDownloadSettings)
    const requested = makeFileName(settings['download.fileName'], input.musicInfo.name, input.musicInfo.singer, extension)
    const fileName = extension === originalExtension
      ? path.basename(original)
      : reserveFileName(directory, requested, this.reservedFileNames(directory))
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
      qualityCandidates,
      extension,
      fileName,
      finalRelativePath: this.mediaRelative(path.join(directory, fileName)),
      partRelativePath: this.tempRelative(path.join(this.tempRoot, `${id}.part`)),
      downloaded: 0,
      total: 0,
      replacement: {
        originalRelativePath: this.mediaRelative(original),
        originalIntegrity: currentIntegrity,
        previousDownloadIds: [...this.records.values()]
          .filter(value => value.status === 'completed' && this.resolveFinal(value.finalRelativePath) === original)
          .map(value => value.id),
        phase: 'downloading',
      },
      useDefaultDownloadSettings: useDefaultDownloadSettings || undefined,
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

  private prepareQuality(record: DownloadJobRecord, quality: TuneFlow.Quality): void {
    if (record.quality === quality) return
    const extension = getExt(quality)
    const directory = record.replacement == null
      ? path.dirname(this.resolveFinal(record.finalRelativePath))
      : path.dirname(this.resolveMedia(record.replacement.originalRelativePath))
    const requested = makeFileName(this.effectiveSettings(record.useDefaultDownloadSettings === true)['download.fileName'], record.musicInfo.name, record.musicInfo.singer, extension)
    const original = record.replacement == null ? undefined : this.resolveMedia(record.replacement.originalRelativePath)
    const fileName = original != null && path.extname(original).slice(1).toLowerCase() === extension
      ? path.basename(original)
      : reserveFileName(directory, requested, this.reservedFileNames(directory, record.id))
    this.update(record, {
      quality,
      extension,
      fileName,
      finalRelativePath: this.mediaRelative(path.join(directory, fileName)),
    })
  }

  private mergeResources(
    current: ResolvedDownload['resources'],
    incoming: ResolvedDownload['resources'],
  ): ResolvedDownload['resources'] {
    if (current == null) return incoming
    if (incoming == null) return current
    return {
      pictureBytes: incoming.pictureBytes ?? current.pictureBytes,
      pictureMimeType: incoming.pictureBytes == null
        ? current.pictureMimeType
        : incoming.pictureMimeType ?? current.pictureMimeType,
      lyrics: incoming.lyrics ?? current.lyrics,
    }
  }

  private requireIntegrity(filePath: string, expected: DownloadFileIntegrity, message: string): void {
    if (!Number.isSafeInteger(expected.size) || expected.size < 0 || !/^[a-f\d]{64}$/.test(expected.sha256) ||
      !existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size !== expected.size ||
      sha256File(filePath) !== expected.sha256) throw new Error(message)
  }

  private stageMediaFile(source: string, final: string, expected?: DownloadFileIntegrity): string {
    const staged = path.join(path.dirname(final), `.${path.basename(final)}.${randomUUID()}.tuneflowtmp`)
    copyFileSync(source, staged, constants.COPYFILE_EXCL)
    const descriptor = openSync(staged, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    if (expected != null) this.requireIntegrity(staged, expected, 'Media publication staging integrity mismatch')
    return staged
  }

  private recoverMetadataPatch(record: DownloadJobRecord, final: string): boolean {
    const marker = record.metadataPatch
    if (marker == null) return false
    try {
      const staged = this.resolveMedia(marker.stagedRelativePath)
      if (!isPathInside(this.audioRoot, staged) || path.dirname(staged) !== path.dirname(final) ||
        !path.basename(staged).endsWith('.tuneflowtmp')) throw new Error('Metadata patch marker path is invalid')
      const finalMatchesReplacement = (() => {
        try { this.requireIntegrity(final, marker.replacementIntegrity, 'mismatch'); return true } catch { return false }
      })()
      if (finalMatchesReplacement) {
        if (existsSync(staged)) rmSync(staged, { force: true })
        record.downloaded = marker.replacementIntegrity.size
        record.total = marker.replacementIntegrity.size
        record.finalIntegrity = marker.replacementIntegrity
        record.metadataPatch = undefined
        return true
      }
      this.requireIntegrity(final, marker.originalIntegrity, 'Metadata patch target changed during recovery')
      if (!existsSync(staged)) {
        record.metadataPatch = undefined
        return false
      }
      this.requireIntegrity(staged, marker.replacementIntegrity, 'Metadata patch staging integrity mismatch during recovery')
      renameSync(staged, final)
      fsyncDirectory(path.dirname(final))
      record.downloaded = marker.replacementIntegrity.size
      record.total = marker.replacementIntegrity.size
      record.finalIntegrity = marker.replacementIntegrity
      record.metadataPatch = undefined
      return true
    } catch (error) {
      record.metadataPatch = undefined
      record.error = error instanceof Error ? error.message : String(error)
      return false
    }
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
      const stagedMedia = marker.stagedMediaRelativePath == null ? part : this.resolveMedia(marker.stagedMediaRelativePath)
      if (marker.stagedMediaRelativePath != null &&
        (path.dirname(stagedMedia) !== path.dirname(final) || !path.basename(stagedMedia).endsWith('.tuneflowtmp'))) {
        throw new Error('Download media publication marker is invalid')
      }
      if (marker.phase === 'published') {
        if (!existsSync(final) || !statSync(final).isFile() || statSync(final).size !== marker.size || sha256File(final) !== marker.sha256) {
          throw new Error('Published download file integrity mismatch')
        }
        this.recoverPublicationSidecar(record)
        if (marker.stagedMediaRelativePath != null) {
          rmSync(stagedMedia, { force: true })
          try { this.removeRejectedPart(part) } catch {}
        }
        this.completeRecovered(record, final)
        return true
      }
      if (existsSync(final) && statSync(final).isFile() && statSync(final).size === marker.size && sha256File(final) === marker.sha256) {
        if (stagedMedia !== part) rmSync(stagedMedia, { force: true })
        try { this.removeRejectedPart(part) } catch {}
        this.recoverPublicationSidecar(record)
        this.completeRecovered(record, final)
        return true
      }
      if (existsSync(stagedMedia) && statSync(stagedMedia).isFile() && statSync(stagedMedia).size === marker.size && sha256File(stagedMedia) === marker.sha256) {
        this.ensureAvailableDestination(record)
        const recoveredFinal = this.resolveFinal(record.finalRelativePath)
        if (marker.stagedLyricRelativePath != null) {
          marker.finalLyricRelativePath = this.mediaRelative(recoveredFinal.slice(0, -path.extname(recoveredFinal).length) + '.lrc')
          this.persist(record)
        }
        this.validatePublicationSidecar(record)
        renameSync(stagedMedia, recoveredFinal)
        this.recoverPublicationSidecar(record)
        fsyncDirectory(path.dirname(recoveredFinal))
        if (stagedMedia !== part) this.removeRejectedPart(part)
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
    const stagedMediaRelative = record.publication?.stagedMediaRelativePath
    const stagedLyricRelative = record.publication?.stagedLyricRelativePath
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
      if (stagedMediaRelative != null) rmSync(this.resolveMedia(stagedMediaRelative), { force: true })
      if (stagedLyricRelative != null) {
        const stagedLyric = stagedMediaRelative == null ? this.resolveTemp(stagedLyricRelative) : this.resolveMedia(stagedLyricRelative)
        rmSync(stagedLyric, { force: true })
      }
      record.partCleanupPending = undefined
      record.updatedAt = this.now()
      this.persist(record)
    } catch (cleanupError) {
      record.error = `${error}; part cleanup pending: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      record.updatedAt = this.now()
      this.persist(record)
    }
  }

  private recoverPublicationSidecar(record: DownloadJobRecord): void {
    const state = this.validatePublicationSidecar(record)
    if (state == null || state.finalExists) return
    renameSync(state.staged, state.final)
    fsyncDirectory(path.dirname(state.final))
  }

  private validatePublicationSidecar(record: DownloadJobRecord): { staged: string, final: string, finalExists: boolean } | undefined {
    const marker = record.publication
    if (marker == null) return undefined
    const stagedRelative = marker.stagedLyricRelativePath
    const finalRelative = marker.finalLyricRelativePath
    if (stagedRelative == null && finalRelative == null) return undefined
    if (typeof stagedRelative !== 'string' || stagedRelative.length === 0 || typeof finalRelative !== 'string' || finalRelative.length === 0) {
      throw new Error('Download sidecar publication marker is invalid')
    }
    const staged = marker.stagedMediaRelativePath == null ? this.resolveTemp(stagedRelative) : this.resolveMedia(stagedRelative)
    const final = this.resolveMedia(finalRelative)
    const stagedExists = existsSync(staged) && statSync(staged).isFile()
    const finalExists = existsSync(final) && statSync(final).isFile()
    if (stagedExists && finalExists) throw new Error('Download sidecar publication conflict')
    if (finalExists) {
      if (marker.lyricIntegrity == null) throw new Error('Download sidecar publication marker has no integrity')
      this.requireIntegrity(final, marker.lyricIntegrity, 'Published download sidecar integrity mismatch')
      return { staged, final, finalExists: true }
    }
    if (!stagedExists) throw new Error('Prepared download sidecar could not be recovered')
    if (marker.lyricIntegrity == null) throw new Error('Download sidecar publication marker has no integrity')
    this.requireIntegrity(staged, marker.lyricIntegrity, 'Prepared download sidecar integrity mismatch')
    return { staged, final, finalExists: false }
  }

  private retryPartCleanup(record: DownloadJobRecord): boolean {
    try {
      this.removeRejectedPart(this.resolveTemp(record.partRelativePath))
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
    const tempRoot = this.tempRoot
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
    record.finalIntegrity = { size, sha256: sha256File(final) }
    record.publication = undefined
    record.partCleanupPending = undefined
    record.error = undefined
  }

  private async finalizeCompletePart(record: DownloadJobRecord): Promise<boolean> {
    const part = this.resolveTemp(record.partRelativePath)
    if (!existsSync(part) || record.total <= 0 || record.downloaded !== record.total || statSync(part).size !== record.total) return false
    this.update(record, { status: 'running', error: undefined })
    await this.finalize(record)
    return true
  }

  private async finalize(record: DownloadJobRecord): Promise<void> {
    if (record.replacement != null) return this.finalizeReplacement(record)
    const part = this.resolveTemp(record.partRelativePath)
    const descriptor = openSync(part, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    const stagedLyric = part + '.lrc'
    const resources = this.resolvedResources.get(record.id)
    let metadataResult: unknown
    try {
      metadataResult = this.options.metadata != null
        ? await this.options.metadata(part, record, this.effectiveSettings(record.useDefaultDownloadSettings === true), resources, stagedLyric)
        : await applyDownloadMetadata(part, record, this.effectiveSettings(record.useDefaultDownloadSettings === true), { ...resources, lyricFilePath: stagedLyric })
    } catch {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
      this.update(record, { downloaded: 0, total: 0 })
      throw new Error('Metadata processing failed')
    }
    if (!this.records.has(record.id) || record.status === 'paused') {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
      if (this.records.has(record.id)) this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
      return
    }
    const stagedDescriptor = openSync(part, 'r')
    try { fsyncSync(stagedDescriptor) } finally { closeSync(stagedDescriptor) }
    if (existsSync(stagedLyric)) {
      const lyricDescriptor = openSync(stagedLyric, 'r')
      try { fsyncSync(lyricDescriptor) } finally { closeSync(lyricDescriptor) }
    }
    const stagedSize = statSync(part).size
    this.update(record, {
      downloaded: stagedSize,
      total: stagedSize,
      warning: this.formatMetadataWarnings(metadataResult),
    })
    if (await this.options.finalizationCheckpoint?.('before-marker', record) === 'simulate-crash') return
    this.ensureAvailableDestination(record)
    const final = this.resolveFinal(record.finalRelativePath)
    const finalLyric = final.slice(0, -path.extname(final).length) + '.lrc'
    if (existsSync(stagedLyric) && existsSync(finalLyric)) {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
      this.update(record, { downloaded: 0, total: 0 })
      throw new Error('Download sidecar destination already exists')
    }
    const partSize = stagedSize
    const partIntegrity = { size: partSize, sha256: sha256File(part) }
    const lyricIntegrity = existsSync(stagedLyric)
      ? { size: statSync(stagedLyric).size, sha256: sha256File(stagedLyric) }
      : undefined
    let mediaStage: string | undefined
    let mediaLyricStage: string | undefined
    if (this.roots.mode === 'split') {
      mediaStage = this.stageMediaFile(part, final, partIntegrity)
      if (lyricIntegrity != null) mediaLyricStage = this.stageMediaFile(stagedLyric, finalLyric, lyricIntegrity)
    }
    this.update(record, {
      publication: {
        phase: 'prepared',
        size: partSize,
        sha256: partIntegrity.sha256,
        ...(mediaStage == null ? {} : { stagedMediaRelativePath: this.mediaRelative(mediaStage) }),
        ...(existsSync(stagedLyric) ? {
          stagedLyricRelativePath: mediaLyricStage == null ? this.tempRelative(stagedLyric) : this.mediaRelative(mediaLyricStage),
          finalLyricRelativePath: this.mediaRelative(finalLyric),
          lyricIntegrity,
        } : {}),
      },
    })
    if (await this.options.finalizationCheckpoint?.('after-marker', record) === 'simulate-crash') return
    this.ensureAvailableDestination(record)
    const publishedFinal = this.resolveFinal(record.finalRelativePath)
    if (record.publication?.stagedLyricRelativePath != null) {
      const publishedLyric = publishedFinal.slice(0, -path.extname(publishedFinal).length) + '.lrc'
      this.update(record, { publication: { ...record.publication, finalLyricRelativePath: this.mediaRelative(publishedLyric) } })
    }
    renameSync(mediaStage ?? part, publishedFinal)
    if (await this.options.finalizationCheckpoint?.('after-rename', record) === 'simulate-crash') return
    if (existsSync(mediaLyricStage ?? stagedLyric)) {
      const publishedLyric = publishedFinal.slice(0, -path.extname(publishedFinal).length) + '.lrc'
      renameSync(mediaLyricStage ?? stagedLyric, publishedLyric)
    }
    fsyncDirectory(path.dirname(publishedFinal))
    if (mediaStage != null) {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
    }
    this.update(record, { publication: { ...record.publication!, phase: 'published' } })
    if (await this.options.finalizationCheckpoint?.('after-publication', record) === 'simulate-crash') return
    let warning = record.warning
    try {
      await this.options.materializeResources?.(publishedFinal)
    } catch {
      const resourceWarning = 'Resources: unavailable'
      warning = warning == null ? resourceWarning : `${warning}; ${resourceWarning}`
    }
    const size = statSync(publishedFinal).size
    this.update(record, {
      status: 'completed',
      downloaded: size,
      total: size,
      finalIntegrity: { size, sha256: sha256File(publishedFinal) },
      publication: undefined,
      finalMissing: undefined,
      warning,
    })
    await this.options.onCompleted?.(publishedFinal, record)
    this.resolvedResources.delete(record.id)
  }

  private async finalizeReplacement(record: DownloadJobRecord): Promise<void> {
    const part = this.resolveTemp(record.partRelativePath)
    const descriptor = openSync(part, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    const final = this.resolveFinal(record.finalRelativePath)
    const stagedLyric = part + '.lrc'
    const finalLyric = final.slice(0, -path.extname(final).length) + '.lrc'
    const resources = this.resolvedResources.get(record.id)
    let metadataResult: unknown
    try {
      if (this.options.metadata != null) {
        metadataResult = await this.options.metadata(part, record, this.effectiveSettings(record.useDefaultDownloadSettings === true), resources, stagedLyric)
      } else {
        metadataResult = await applyDownloadMetadata(part, record, this.effectiveSettings(record.useDefaultDownloadSettings === true), { ...resources, lyricFilePath: stagedLyric })
      }
    } catch {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
      throw new Error('DOWNLOAD_REPLACEMENT_FAILED: Metadata processing failed')
    }
    if (!this.records.has(record.id) || record.status === 'paused') {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
      if (this.records.has(record.id)) this.update(record, { downloaded: 0, total: 0, etag: undefined, lastModified: undefined })
      return
    }
    const size = statSync(part).size
    const replacementIntegrity = { size, sha256: sha256File(part) }
    const lyricIntegrity = existsSync(stagedLyric)
      ? { size: statSync(stagedLyric).size, sha256: sha256File(stagedLyric) }
      : undefined
    const mediaStage = this.roots.mode === 'split' ? this.stageMediaFile(part, final, replacementIntegrity) : undefined
    const mediaLyricStage = this.roots.mode === 'split' && existsSync(stagedLyric)
      ? this.stageMediaFile(stagedLyric, finalLyric, lyricIntegrity)
      : undefined
    this.update(record, {
      replacement: {
        ...record.replacement!,
        phase: 'prepared',
        replacementIntegrity,
        stagedMediaRelativePath: mediaStage == null ? undefined : this.mediaRelative(mediaStage),
        stagedLyricRelativePath: existsSync(stagedLyric)
          ? mediaLyricStage == null ? this.tempRelative(stagedLyric) : this.mediaRelative(mediaLyricStage)
          : undefined,
        finalLyricRelativePath: existsSync(stagedLyric) ? this.mediaRelative(finalLyric) : undefined,
        lyricIntegrity,
      },
      warning: this.formatMetadataWarnings(metadataResult),
    })
    this.publishReplacement(record)
    if (mediaStage != null) {
      rmSync(part, { force: true })
      rmSync(stagedLyric, { force: true })
    }
    let warning = record.warning
    try { await this.options.materializeResources?.(final) } catch { warning = warning == null ? 'Resources: unavailable' : `${warning}; Resources: unavailable` }
    const finalSize = statSync(final).size
    this.update(record, {
      status: 'completed',
      downloaded: finalSize,
      total: finalSize,
      finalIntegrity: { size: finalSize, sha256: sha256File(final) },
      finalMissing: undefined,
      warning,
    })
    await this.options.onCompleted?.(final, record)
    this.resolvedResources.delete(record.id)
  }

  private publishReplacement(record: DownloadJobRecord): void {
    const replacement = record.replacement!
    if (replacement.replacementIntegrity == null) throw new Error('DOWNLOAD_REPLACEMENT_FAILED: missing staged integrity')
    this.validateReplacementLyric(record)
    this.replacementPublisher.publish({
      originalPath: this.resolveMedia(replacement.originalRelativePath),
      stagedPath: replacement.stagedMediaRelativePath == null
        ? this.resolveTemp(record.partRelativePath)
        : this.resolveMedia(replacement.stagedMediaRelativePath),
      finalPath: this.resolveFinal(record.finalRelativePath),
      originalIntegrity: replacement.originalIntegrity,
      replacementIntegrity: replacement.replacementIntegrity,
      stagedLyricPath: replacement.stagedLyricRelativePath == null
        ? undefined
        : replacement.stagedMediaRelativePath == null
          ? this.resolveTemp(replacement.stagedLyricRelativePath)
          : this.resolveMedia(replacement.stagedLyricRelativePath),
      finalLyricPath: replacement.finalLyricRelativePath == null ? undefined : this.resolveMedia(replacement.finalLyricRelativePath),
      phase: replacement.phase,
      onPhase: phase => { this.update(record, { replacement: { ...record.replacement!, phase } }) },
    })
    this.retirePreviousRecords(record)
  }

  private recoverReplacement(record: DownloadJobRecord): boolean {
    try {
      const replacement = record.replacement!
      if (replacement.replacementIntegrity == null) throw new Error('DOWNLOAD_REPLACEMENT_FAILED: missing staged integrity')
      this.validateReplacementLyric(record)
      this.replacementPublisher.recover({
        originalPath: this.resolveMedia(replacement.originalRelativePath),
        stagedPath: replacement.stagedMediaRelativePath == null
          ? this.resolveTemp(record.partRelativePath)
          : this.resolveMedia(replacement.stagedMediaRelativePath),
        finalPath: this.resolveFinal(record.finalRelativePath),
        originalIntegrity: replacement.originalIntegrity,
        replacementIntegrity: replacement.replacementIntegrity,
        stagedLyricPath: replacement.stagedLyricRelativePath == null
          ? undefined
          : replacement.stagedMediaRelativePath == null
            ? this.resolveTemp(replacement.stagedLyricRelativePath)
            : this.resolveMedia(replacement.stagedLyricRelativePath),
        finalLyricPath: replacement.finalLyricRelativePath == null ? undefined : this.resolveMedia(replacement.finalLyricRelativePath),
        phase: replacement.phase,
        onPhase: phase => { record.replacement = { ...record.replacement!, phase }; this.persist(record) },
      })
      if (replacement.stagedMediaRelativePath != null) {
        rmSync(this.resolveTemp(record.partRelativePath), { force: true })
        rmSync(this.resolveTemp(record.partRelativePath) + '.lrc', { force: true })
      }
      this.retirePreviousRecords(record)
      this.completeRecovered(record, this.resolveFinal(record.finalRelativePath))
      return true
    } catch (error) {
      record.status = 'error'
      record.error = error instanceof Error ? error.message : String(error)
      this.persist(record)
      return false
    }
  }

  private validateReplacementLyric(record: DownloadJobRecord): void {
    const replacement = record.replacement!
    if (replacement.stagedLyricRelativePath == null && replacement.finalLyricRelativePath == null) return
    if (replacement.lyricIntegrity == null) throw new Error('DOWNLOAD_REPLACEMENT_FAILED: missing sidecar integrity')
    const staged = replacement.stagedLyricRelativePath == null
      ? undefined
      : replacement.stagedMediaRelativePath == null
        ? this.resolveTemp(replacement.stagedLyricRelativePath)
        : this.resolveMedia(replacement.stagedLyricRelativePath)
    const final = replacement.finalLyricRelativePath == null ? undefined : this.resolveMedia(replacement.finalLyricRelativePath)
    if (staged != null && existsSync(staged)) {
      this.requireIntegrity(staged, replacement.lyricIntegrity, 'DOWNLOAD_REPLACEMENT_FAILED: sidecar integrity mismatch')
    } else if (final != null && existsSync(final)) {
      this.requireIntegrity(final, replacement.lyricIntegrity, 'DOWNLOAD_REPLACEMENT_FAILED: published sidecar integrity mismatch')
    } else {
      throw new Error('DOWNLOAD_REPLACEMENT_FAILED: sidecar is missing')
    }
  }

  private retirePreviousRecords(record: DownloadJobRecord): void {
    const ids = record.replacement?.previousDownloadIds ?? []
    const remove = this.db.prepare('DELETE FROM web_downloads WHERE id = ?')
    for (const id of ids) {
      if (id === record.id) continue
      this.records.delete(id)
      remove.run(id)
    }
  }

  private ensureAvailableDestination(record: DownloadJobRecord): void {
    const current = this.resolveFinal(record.finalRelativePath)
    const directory = path.dirname(current)
    const reserved = this.reservedFileNames(directory, record.id)
    if (!existsSync(current) && !reserved.has(record.fileName)) return
    const fileName = reserveFileName(directory, record.fileName, reserved)
    record.fileName = fileName
    record.finalRelativePath = this.mediaRelative(path.join(directory, fileName))
    record.updatedAt = this.now()
    this.persist(record)
    this.publish()
  }

  private effectiveSettings(useDefaults: boolean): TuneFlow.AppSetting {
    const current = this.options.getSettings()
    if (!useDefaults) return current
    const effective: TuneFlow.AppSetting = { ...current }
    for (const [key, value] of Object.entries(defaultSetting)) {
      if (key.startsWith('download.')) (effective as unknown as Record<string, unknown>)[key] = value
    }
    effective['download.savePath'] = current['download.savePath']
    return effective
  }

  private formatMetadataWarnings(result: unknown): string | undefined {
    const warnings = typeof result === 'object' && result != null && 'warnings' in result && Array.isArray(result.warnings)
      ? result.warnings
      : []
    const safe = warnings.filter(value => value === 'Artwork unavailable' || value === 'Lyrics unavailable')
    return safe.length === 0 ? undefined : safe.map(value => `Metadata: ${value}`).join('; ')
  }

  private reservedFileNames(directory: string, excludedId?: string): Set<string> {
    return new Set([...this.records.values()]
      .filter(record => record.id !== excludedId && path.dirname(this.resolveFinal(record.finalRelativePath)) === directory)
      .filter(record => record.finalMissing !== true && (record.status !== 'completed' || existsSync(this.resolveFinal(record.finalRelativePath))))
      .map(record => record.fileName))
  }

  private mediaRelative(filePath: string): string {
    if (!isPathInside(this.audioRoot, filePath)) throw new Error('Path escaped media root')
    const base = this.roots.mode === 'legacy' ? this.roots.databaseRoot : this.audioRoot
    return path.relative(base, filePath).split(path.sep).join('/')
  }

  private tempRelative(filePath: string): string {
    if (!isPathInside(this.tempRoot, filePath)) throw new Error('Path escaped temp root')
    const base = this.roots.mode === 'legacy' ? this.roots.databaseRoot : this.tempRoot
    return path.relative(base, filePath).split(path.sep).join('/')
  }

  private resolveMedia(relative: string): string {
    const base = this.roots.mode === 'legacy' ? this.roots.databaseRoot : this.audioRoot
    const resolved = path.resolve(base, relative)
    if (!isPathInside(this.audioRoot, resolved)) throw new Error('Stored path escaped media root')
    return resolved
  }

  private resolveTemp(relative: string): string {
    const base = this.roots.mode === 'legacy' ? this.roots.databaseRoot : this.tempRoot
    const resolved = path.resolve(base, relative)
    if (!isPathInside(this.tempRoot, resolved)) throw new Error('Stored path escaped temp root')
    return resolved
  }

  private resolveFinal(relative: string): string {
    return this.resolveMedia(relative)
  }

  private normalizeFinalPath(record: DownloadJobRecord): void {
    const base = this.roots.mode === 'legacy' ? this.roots.databaseRoot : this.audioRoot
    const resolved = path.resolve(base, record.finalRelativePath)
    if (isPathInside(this.audioRoot, resolved)) return
    record.fileName = path.basename(record.fileName)
    record.finalRelativePath = this.mediaRelative(path.join(this.audioRoot, record.fileName))
  }

  private cleanupOrphanParts(): void {
    const referenced = new Set([...this.records.values()].map(record => path.basename(record.partRelativePath)))
    for (const name of readdirSync(this.tempRoot)) {
      if (name.endsWith('.part')) {
        if (referenced.has(name)) continue
        try { this.removeRejectedPart(path.join(this.tempRoot, name)) } catch {}
      } else if (name.endsWith('.part.lrc') && !referenced.has(name.slice(0, -4))) {
        rmSync(path.join(this.tempRoot, name), { force: true })
      }
    }
  }

  private cleanupOrphanMediaStages(): void {
    const referenced = new Set<string>()
    const remember = (relative: string | undefined): void => {
      if (relative == null) return
      try { referenced.add(path.resolve(this.resolveMedia(relative))) } catch {}
    }
    for (const record of this.records.values()) {
      remember(record.publication?.stagedMediaRelativePath)
      if (record.publication?.stagedMediaRelativePath != null) remember(record.publication.stagedLyricRelativePath)
      remember(record.replacement?.stagedMediaRelativePath)
      if (record.replacement?.stagedMediaRelativePath != null) remember(record.replacement.stagedLyricRelativePath)
      remember(record.metadataPatch?.stagedRelativePath)
    }
    const generatedName = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.rollback)?\.tuneflowtmp$/
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const candidate = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          visit(candidate)
        } else if (entry.isFile() && generatedName.test(entry.name) && !referenced.has(path.resolve(candidate))) {
          rmSync(candidate, { force: true })
        }
      }
    }
    visit(this.audioRoot)
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
