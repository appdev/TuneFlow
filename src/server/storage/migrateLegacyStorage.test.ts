import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATION_JOURNAL_FILENAME, migrateLegacyStorage } from './migrateLegacyStorage'
import { parseMigrationArguments } from './migrateLegacyStorageCli'

const roots: string[] = []
const root = (): string => {
  const value = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-storage-migration-'))
  roots.push(value)
  return value
}

const manifest = (directory: string): string[] => {
  const values: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name)
      const relative = path.relative(directory, full).split(path.sep).join('/')
      if (entry.isDirectory()) visit(full)
      else values.push(`${relative}:${statSync(full).mode & 0o777}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`)
    }
  }
  visit(directory)
  return values
}

const legacyFixture = (): { legacyRoot: string, sourceBefore: string[] } => {
  const legacyRoot = root()
  for (const name of ['audio/nested', 'sources', 'backups', 'cover', 'lyrics', 'library-resource-index', 'tmp', 'logs']) {
    mkdirSync(path.join(legacyRoot, name), { recursive: true })
  }
  writeFileSync(path.join(legacyRoot, 'audio', 'nested', 'track.mp3'), 'audio bytes')
  writeFileSync(path.join(legacyRoot, 'audio', 'nested', 'track.lrc'), '[00:00.00]lyric')
  const sourceScript = 'source script'
  const sourceHash = createHash('sha256').update(sourceScript).digest('hex')
  writeFileSync(path.join(legacyRoot, 'sources', `${sourceHash}.js`), sourceScript)
  writeFileSync(path.join(legacyRoot, 'backups', 'manual.zip'), 'backup')
  writeFileSync(path.join(legacyRoot, 'cover', 'derived.jpg'), 'derived')
  writeFileSync(path.join(legacyRoot, 'tmp', 'unfinished.part'), 'partial')
  const database = new Database(path.join(legacyRoot, 'tuneflow.data.db'))
  database.exec(`
    CREATE TABLE web_downloads (id TEXT PRIMARY KEY, status TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE web_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE web_sources (id TEXT PRIMARY KEY, script_path TEXT NOT NULL);
  `)
  const completed = {
    id: 'done',
    status: 'completed',
    fileName: 'track.mp3',
    finalRelativePath: 'audio/nested/track.mp3',
    partRelativePath: 'tmp/done.part',
    downloaded: 11,
    total: 11,
    createdAt: 1,
    updatedAt: 2,
    replacement: {
      originalRelativePath: 'audio/nested/old.mp3',
      originalIntegrity: { size: 1, sha256: '0'.repeat(64) },
      previousDownloadIds: [],
      phase: 'retired',
      replacementIntegrity: { size: 11, sha256: '1'.repeat(64) },
      stagedMediaRelativePath: 'audio/.staged.tuneflowtmp',
    },
  }
  const unfinished = {
    id: 'pending',
    status: 'running',
    fileName: 'pending.mp3',
    finalRelativePath: 'audio/pending.mp3',
    partRelativePath: 'tmp/unfinished.part',
    downloaded: 7,
    total: 99,
    etag: 'secret-validator',
    lastModified: 'yesterday',
    createdAt: 3,
    updatedAt: 4,
  }
  const insert = database.prepare('INSERT INTO web_downloads VALUES (?, ?, ?, ?, ?)')
  insert.run('done', 'completed', JSON.stringify(completed), 1, 2)
  insert.run('pending', 'running', JSON.stringify(unfinished), 3, 4)
  database.prepare('INSERT INTO web_settings VALUES (?, ?)').run('download.savePath', JSON.stringify(path.join(legacyRoot, 'audio')))
  database.prepare('INSERT INTO web_sources VALUES (?, ?)').run(`user_api_${sourceHash}`, `${sourceHash}.js`)
  database.close()
  return { legacyRoot, sourceBefore: manifest(legacyRoot) }
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('legacy storage migration', () => {
  it('accepts only the bounded migration CLI arguments', () => {
    expect(parseMigrationArguments(['--help'])).toEqual({ help: true })
    expect(parseMigrationArguments(['--from', '/old', '--config-root', '/config', '--media-root', '/music'])).toEqual({
      help: false,
      legacyRoot: '/old',
      configRoot: '/config',
      mediaRoot: '/music',
    })
    expect(() => parseMigrationArguments(['--from', '/old', '--config-root', '/config', '--media-root', '/music', '--force']))
      .toThrow('Unknown migration argument: --force')
  })

  it('copies durable state and media while leaving the legacy source byte-identical', async() => {
    const { legacyRoot, sourceBefore } = legacyFixture()
    const target = root()
    const configRoot = path.join(target, 'config')
    const mediaRoot = path.join(target, 'music')

    const result = await migrateLegacyStorage({ legacyRoot, configRoot, mediaRoot, now: () => 1234, createId: () => 'fixture-stage' })

    expect(result).toMatchObject({ layoutVersion: 1, mediaFiles: 2, sourceFiles: 1 })
    expect(manifest(legacyRoot)).toEqual(sourceBefore)
    expect(readFileSync(path.join(mediaRoot, 'nested', 'track.mp3'), 'utf8')).toBe('audio bytes')
    expect(readFileSync(path.join(configRoot, 'sources', `${createHash('sha256').update('source script').digest('hex')}.js`), 'utf8')).toBe('source script')
    expect(readFileSync(path.join(configRoot, 'backups', 'manual.zip'), 'utf8')).toBe('backup')
    expect(existsSync(path.join(configRoot, 'cover'))).toBe(false)
    expect(existsSync(path.join(mediaRoot, 'tmp'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(configRoot, 'storage-layout.json'), 'utf8'))).toMatchObject({
      version: 1,
      migratedAt: new Date(1234).toISOString(),
      sourceManifestDigest: result.sourceManifestDigest,
    })

    const migrated = new Database(path.join(configRoot, 'database', 'tuneflow.data.db'), { readonly: true })
    const rows = migrated.prepare('SELECT id, status, record FROM web_downloads ORDER BY id').all() as Array<{ id: string, status: string, record: string }>
    migrated.close()
    expect(JSON.parse(rows[0].record)).toMatchObject({ id: 'done', status: 'completed', finalRelativePath: 'nested/track.mp3', partRelativePath: 'done.part' })
    expect(JSON.parse(rows[0].record)).not.toHaveProperty('replacement')
    expect(JSON.parse(rows[1].record)).toMatchObject({ id: 'pending', status: 'paused', downloaded: 0, total: 0, partRelativePath: 'pending.part' })
    expect(JSON.parse(rows[1].record)).not.toHaveProperty('etag')
    expect(JSON.parse(rows[1].record)).not.toHaveProperty('lastModified')
  })

  it('rejects non-empty targets without changing either side', async() => {
    const { legacyRoot, sourceBefore } = legacyFixture()
    const target = root()
    const configRoot = path.join(target, 'config')
    const mediaRoot = path.join(target, 'music')
    mkdirSync(configRoot)
    mkdirSync(mediaRoot)
    writeFileSync(path.join(configRoot, 'existing'), 'keep')

    await expect(migrateLegacyStorage({ legacyRoot, configRoot, mediaRoot })).rejects.toThrow('Migration targets must be empty')
    expect(manifest(legacyRoot)).toEqual(sourceBefore)
    expect(readFileSync(path.join(configRoot, 'existing'), 'utf8')).toBe('keep')
    expect(readdirSync(mediaRoot)).toEqual([])
  })

  it('cleans files created by an interrupted copy and never removes source files', async() => {
    const { legacyRoot, sourceBefore } = legacyFixture()
    const target = root()
    const configRoot = path.join(target, 'config')
    const mediaRoot = path.join(target, 'music')

    await expect(migrateLegacyStorage({
      legacyRoot,
      configRoot,
      mediaRoot,
      onPhase: phase => { if (phase === 'normalize') throw new Error('injected interruption') },
    })).rejects.toThrow('injected interruption')
    expect(manifest(legacyRoot)).toEqual(sourceBefore)
    expect(readdirSync(configRoot)).toEqual([])
    expect(readdirSync(mediaRoot)).toEqual([])
  })

  it('removes only journal-owned artifacts from a previously interrupted publish and reruns', async() => {
    const { legacyRoot } = legacyFixture()
    const target = root()
    const configRoot = path.join(target, 'config')
    const mediaRoot = path.join(target, 'music')
    let journal = ''
    await expect(migrateLegacyStorage({
      legacyRoot,
      configRoot,
      mediaRoot,
      createId: () => 'recoverable',
      onPhase: phase => {
        if (phase === 'copy') {
          journal = readFileSync(path.join(configRoot, MIGRATION_JOURNAL_FILENAME), 'utf8')
          throw new Error('simulated abrupt stop')
        }
      },
    })).rejects.toThrow('simulated abrupt stop')
    writeFileSync(path.join(configRoot, MIGRATION_JOURNAL_FILENAME), journal)
    mkdirSync(path.join(configRoot, 'database'))
    writeFileSync(path.join(configRoot, 'database', 'partial'), 'partial')
    mkdirSync(path.join(mediaRoot, 'nested'), { recursive: true })
    writeFileSync(path.join(mediaRoot, 'nested', 'partial'), 'partial')

    await expect(migrateLegacyStorage({ legacyRoot, configRoot, mediaRoot, createId: () => 'retry' })).resolves.toMatchObject({ layoutVersion: 1 })
    expect(existsSync(path.join(mediaRoot, 'nested', 'track.mp3'))).toBe(true)
  })
})
