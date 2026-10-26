import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DATABASE_FILENAME } from '../db/databasePath'
import { writeSplitLayoutMarker } from './layoutMarker'
import { validateInstalledSourceFiles } from '../sources/storageValidation'

export type MigrationPhase = 'preflight' | 'copy' | 'normalize' | 'verify' | 'publish'

export interface MigrationOptions {
  legacyRoot: string
  configRoot: string
  mediaRoot: string
  now?: () => number
  createId?: () => string
  statfs?: typeof statfsSync
  onPhase?: (phase: MigrationPhase) => void
}

export interface MigrationResult {
  layoutVersion: 1
  mediaFiles: number
  mediaBytes: number
  sourceFiles: number
  sourceManifestDigest: string
}

interface ManifestEntry { path: string, size: number, mode: number, sha256: string }
interface MigrationJournal {
  version: 1
  id: string
  legacyRoot: string
  sourceManifestDigest: string
  configEntries: string[]
  mediaEntries: string[]
}

export const MIGRATION_JOURNAL_FILENAME = '.tuneflow-migration.json'

const legacyDatabaseName = [['l', 'x'].join(''), 'data', 'db'].join('.')

const normalizedRelative = (value: string): string => value.split(path.sep).join('/')

const sha256File = (filePath: string): string => {
  const hash = createHash('sha256')
  const descriptor = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let size = 0
    while ((size = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size))
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

const fsyncFile = (filePath: string): void => {
  const descriptor = openSync(filePath, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

const fsyncTreeDirectories = (root: string): void => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) fsyncTreeDirectories(path.join(root, entry.name))
  }
  fsyncDirectory(root)
}

const writeJournal = (configRoot: string, journal: MigrationJournal): void => {
  const target = path.join(configRoot, MIGRATION_JOURNAL_FILENAME)
  const temporary = `${target}.${journal.id}.tmp`
  writeFileSync(temporary, `${JSON.stringify(journal)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  fsyncFile(temporary)
  renameSync(temporary, target)
  fsyncDirectory(configRoot)
}

const recoverJournal = (configRoot: string, mediaRoot: string, legacyRoot: string, sourceDigest: string): boolean => {
  const journalPath = path.join(configRoot, MIGRATION_JOURNAL_FILENAME)
  if (!existsSync(journalPath)) return false
  let journal: MigrationJournal
  try { journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal } catch { throw new Error('Invalid migration journal') }
  if (journal.version !== 1 || journal.legacyRoot !== legacyRoot || journal.sourceManifestDigest !== sourceDigest ||
    !Array.isArray(journal.configEntries) || !Array.isArray(journal.mediaEntries)) throw new Error('Migration journal does not match this source')
  const safeName = (value: string): boolean => value !== '' && path.basename(value) === value && value !== '.' && value !== '..'
  if (![...journal.configEntries, ...journal.mediaEntries].every(safeName)) throw new Error('Invalid migration journal')
  const allowedConfig = new Set([MIGRATION_JOURNAL_FILENAME, `.tuneflow-migration-${journal.id}`, ...journal.configEntries])
  const allowedMedia = new Set([`.tuneflow-migration-${journal.id}`, ...journal.mediaEntries])
  if (readdirSync(configRoot).some(name => !allowedConfig.has(name)) || readdirSync(mediaRoot).some(name => !allowedMedia.has(name))) {
    throw new Error('Migration targets contain state not owned by the interrupted migration')
  }
  for (const name of allowedConfig) rmSync(path.join(configRoot, name), { recursive: true, force: true })
  for (const name of allowedMedia) rmSync(path.join(mediaRoot, name), { recursive: true, force: true })
  fsyncDirectory(configRoot)
  fsyncDirectory(mediaRoot)
  return true
}

const walkFiles = (root: string): ManifestEntry[] => {
  if (!existsSync(root)) return []
  const entries: ManifestEntry[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Migration source contains a symbolic link: ${normalizedRelative(path.relative(root, filePath))}`)
      if (entry.isDirectory()) {
        visit(filePath)
        continue
      }
      if (!entry.isFile()) throw new Error(`Migration source contains an unsupported entry: ${normalizedRelative(path.relative(root, filePath))}`)
      const stat = statSync(filePath)
      entries.push({
        path: normalizedRelative(path.relative(root, filePath)),
        size: stat.size,
        mode: stat.mode & 0o777,
        sha256: sha256File(filePath),
      })
    }
  }
  visit(root)
  return entries
}

const manifestDigest = (entries: ManifestEntry[]): string => createHash('sha256').update(JSON.stringify(entries)).digest('hex')

const copyTree = (sourceRoot: string, targetRoot: string): ManifestEntry[] => {
  const entries = walkFiles(sourceRoot)
  for (const entry of entries) {
    const source = path.join(sourceRoot, ...entry.path.split('/'))
    const target = path.join(targetRoot, ...entry.path.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, entry.mode)
    fsyncFile(target)
    const copied = statSync(target)
    const digest = sha256File(target)
    if (copied.size !== entry.size || digest !== entry.sha256) throw new Error(`Migration checksum mismatch: ${entry.path}`)
  }
  return entries
}

const canonicalExistingOrProspective = (input: string): string => {
  let candidate = path.resolve(input)
  const suffix: string[] = []
  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate)
    if (parent === candidate) throw new Error(`Unable to resolve migration path: ${input}`)
    suffix.unshift(path.basename(candidate))
    candidate = parent
  }
  return path.join(realpathSync(candidate), ...suffix)
}

const contains = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

const requireSeparateRoots = (roots: string[]): void => {
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (contains(roots[left], roots[right]) || contains(roots[right], roots[left])) {
        throw new Error('Migration roots must be distinct and non-overlapping')
      }
    }
  }
}

const availableBytes = (root: string, statfs: typeof statfsSync): number => {
  const value = statfs(root)
  return Number(value.bavail) * Number(value.bsize)
}

const stripLegacyMediaPrefix = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid ${field} in legacy download record`)
  const normalized = value.replaceAll('\\', '/')
  if (!normalized.startsWith('audio/')) throw new Error(`Legacy ${field} is outside audio`)
  const relative = normalized.slice('audio/'.length)
  if (relative === '' || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`Legacy ${field} is outside audio`)
  }
  return relative
}

const normalizeOptionalMediaPath = (record: Record<string, unknown>, key: string): void => {
  if (record[key] != null) record[key] = stripLegacyMediaPrefix(record[key], key)
}

const normalizeDatabase = (databasePath: string, mediaRoot: string, now: number): void => {
  const database = new Database(databasePath)
  try {
    const integrity = database.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Migrated database integrity check failed: ${String(integrity)}`)
    const hasDownloads = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_downloads'").get() != null
    if (hasDownloads) {
      const rows = database.prepare('SELECT id, record FROM web_downloads').all() as Array<{ id: string, record: string }>
      const update = database.prepare('UPDATE web_downloads SET status=?, record=?, updated_at=? WHERE id=?')
      database.transaction(() => {
        for (const row of rows) {
          const record = JSON.parse(row.record) as Record<string, unknown>
          const completed = record.status === 'completed'
          record.finalRelativePath = stripLegacyMediaPrefix(record.finalRelativePath, 'finalRelativePath')
          record.partRelativePath = `${row.id}.part`
          const replacement = typeof record.replacement === 'object' && record.replacement != null
            ? record.replacement as Record<string, unknown>
            : undefined
          if (replacement != null) normalizeOptionalMediaPath(replacement, 'originalRelativePath')
          const metadataPatch = typeof record.metadataPatch === 'object' && record.metadataPatch != null
            ? record.metadataPatch as Record<string, unknown>
            : undefined
          if (metadataPatch != null) normalizeOptionalMediaPath(metadataPatch, 'stagedRelativePath')
          if (!completed) {
            record.status = 'paused'
            record.downloaded = 0
            record.total = 0
            delete record.etag
            delete record.lastModified
            delete record.publication
            delete record.metadataPatch
            if (replacement != null) {
              replacement.phase = 'downloading'
              delete replacement.replacementIntegrity
              delete replacement.stagedMediaRelativePath
              delete replacement.stagedLyricRelativePath
              delete replacement.finalLyricRelativePath
            }
          } else {
            delete record.publication
            delete record.metadataPatch
            delete record.replacement
          }
          record.updatedAt = now
          update.run(String(record.status), JSON.stringify(record), now, row.id)
        }
      })()
    }
    const hasSettings = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_settings'").get() != null
    if (hasSettings) {
      database.prepare(`INSERT INTO web_settings (key, value) VALUES ('download.savePath', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(mediaRoot))
    }
    database.pragma('journal_mode = DELETE')
    const verified = database.pragma('integrity_check', { simple: true })
    if (verified !== 'ok') throw new Error(`Migrated database integrity check failed: ${String(verified)}`)
  } finally {
    database.close()
  }
}

const verifySourceScripts = (databasePath: string, sourceRoot: string): void => {
  const database = new Database(databasePath, { readonly: true })
  try {
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_sources'").get() == null) return
    validateInstalledSourceFiles(database, sourceRoot)
  } finally {
    database.close()
  }
}

const verifyCompletedDownloads = (databasePath: string, mediaRoot: string): void => {
  const database = new Database(databasePath, { readonly: true })
  try {
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_downloads'").get() == null) return
    const rows = database.prepare("SELECT id, record FROM web_downloads WHERE status='completed'").all() as Array<{ id: string, record: string }>
    for (const row of rows) {
      const record = JSON.parse(row.record) as { finalRelativePath?: unknown }
      if (typeof record.finalRelativePath !== 'string' || record.finalRelativePath === '' ||
        path.posix.isAbsolute(record.finalRelativePath) || record.finalRelativePath.split('/').includes('..')) {
        throw new Error(`Invalid completed download path: ${row.id}`)
      }
      const target = path.join(mediaRoot, ...record.finalRelativePath.split('/'))
      if (!existsSync(target) || !lstatSync(target).isFile()) throw new Error(`Completed download file is missing: ${row.id}`)
    }
  } finally {
    database.close()
  }
}

const removeCreatedEntries = (root: string): void => {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) rmSync(path.join(root, entry), { recursive: true, force: true })
}

export const migrateLegacyStorage = async(options: MigrationOptions): Promise<MigrationResult> => {
  const phase = (value: MigrationPhase): void => { options.onPhase?.(value) }
  phase('preflight')
  const legacyRoot = canonicalExistingOrProspective(options.legacyRoot)
  if (!existsSync(legacyRoot) || !lstatSync(legacyRoot).isDirectory()) throw new Error('Legacy storage root does not exist')
  const configRoot = canonicalExistingOrProspective(options.configRoot)
  const mediaRoot = canonicalExistingOrProspective(options.mediaRoot)
  requireSeparateRoots([legacyRoot, configRoot, mediaRoot])
  mkdirSync(configRoot, { recursive: true })
  mkdirSync(mediaRoot, { recursive: true })
  const sourceBefore = walkFiles(legacyRoot)
  const sourceDigest = manifestDigest(sourceBefore)
  recoverJournal(configRoot, mediaRoot, legacyRoot, sourceDigest)
  if (readdirSync(configRoot).length > 0 || readdirSync(mediaRoot).length > 0) throw new Error('Migration targets must be empty')
  const targetsValidated = true
  const databaseCandidates = [DATABASE_FILENAME, legacyDatabaseName].filter(name => existsSync(path.join(legacyRoot, name)))
  if (databaseCandidates.length !== 1) throw new Error('Legacy storage must contain exactly one recognized database')
  const mediaSource = path.join(legacyRoot, 'audio')
  if (!existsSync(mediaSource)) throw new Error('Legacy storage is missing audio')
  const mediaEntries = walkFiles(mediaSource)
  const configBytes = sourceBefore.filter(entry =>
    entry.path === databaseCandidates[0] || entry.path.startsWith(`${databaseCandidates[0]}-`) ||
    entry.path.startsWith('sources/') || entry.path.startsWith('backups/'),
  ).reduce((total, entry) => total + entry.size, 0)
  const mediaBytes = mediaEntries.reduce((total, entry) => total + entry.size, 0)
  const statfs = options.statfs ?? statfsSync
  if (availableBytes(configRoot, statfs) < configBytes || availableBytes(mediaRoot, statfs) < mediaBytes) {
    throw new Error('Insufficient free space for migration')
  }

  const id = options.createId?.() ?? randomUUID()
  const configStage = path.join(configRoot, `.tuneflow-migration-${id}`)
  const mediaStage = path.join(mediaRoot, `.tuneflow-migration-${id}`)
  const configEntries = ['database', 'sources', 'backups', 'storage-layout.json']
  const mediaTopEntries = [...new Set(mediaEntries.map(entry => entry.path.split('/')[0]))]
  let committed = false
  try {
    writeJournal(configRoot, { version: 1, id, legacyRoot, sourceManifestDigest: sourceDigest, configEntries, mediaEntries: mediaTopEntries })
    phase('copy')
    mkdirSync(path.join(configStage, 'database'), { recursive: true })
    mkdirSync(mediaStage, { recursive: true })
    const sourceDatabase = path.join(legacyRoot, databaseCandidates[0])
    copyFileSync(sourceDatabase, path.join(configStage, 'database', DATABASE_FILENAME))
    fsyncFile(path.join(configStage, 'database', DATABASE_FILENAME))
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${sourceDatabase}${suffix}`)) {
        const sidecarTarget = path.join(configStage, 'database', `${DATABASE_FILENAME}${suffix}`)
        copyFileSync(`${sourceDatabase}${suffix}`, sidecarTarget)
        fsyncFile(sidecarTarget)
      }
    }
    const sourceEntries = copyTree(path.join(legacyRoot, 'sources'), path.join(configStage, 'sources'))
    copyTree(path.join(legacyRoot, 'backups'), path.join(configStage, 'backups'))
    copyTree(mediaSource, mediaStage)

    phase('normalize')
    const stagedDatabase = path.join(configStage, 'database', DATABASE_FILENAME)
    normalizeDatabase(stagedDatabase, mediaRoot, options.now?.() ?? Date.now())
    fsyncFile(stagedDatabase)
    verifySourceScripts(stagedDatabase, path.join(configStage, 'sources'))
    verifyCompletedDownloads(stagedDatabase, mediaStage)

    phase('verify')
    if (manifestDigest(walkFiles(legacyRoot)) !== sourceDigest) throw new Error('Legacy source changed during migration')
    for (const entry of mediaEntries) {
      const target = path.join(mediaStage, ...entry.path.split('/'))
      if (!existsSync(target) || statSync(target).size !== entry.size ||
        sha256File(target) !== entry.sha256) {
        throw new Error(`Migration verification failed: ${entry.path}`)
      }
    }
    fsyncTreeDirectories(configStage)
    fsyncTreeDirectories(mediaStage)

    phase('publish')
    for (const entry of readdirSync(configStage)) renameSync(path.join(configStage, entry), path.join(configRoot, entry))
    rmSync(configStage, { recursive: true, force: true })
    fsyncDirectory(configRoot)
    for (const entry of readdirSync(mediaStage)) renameSync(path.join(mediaStage, entry), path.join(mediaRoot, entry))
    rmSync(mediaStage, { recursive: true, force: true })
    fsyncDirectory(mediaRoot)
    writeSplitLayoutMarker(configRoot, { migratedAt: new Date(options.now?.() ?? Date.now()).toISOString(), sourceManifestDigest: sourceDigest })
    rmSync(path.join(configRoot, MIGRATION_JOURNAL_FILENAME), { force: true })
    fsyncDirectory(configRoot)
    committed = true
    return {
      layoutVersion: 1,
      mediaFiles: mediaEntries.length,
      mediaBytes,
      sourceFiles: sourceEntries.length,
      sourceManifestDigest: sourceDigest,
    }
  } catch (error) {
    if (targetsValidated && !committed) {
      removeCreatedEntries(configRoot)
      removeCreatedEntries(mediaRoot)
    }
    throw error
  }
}
