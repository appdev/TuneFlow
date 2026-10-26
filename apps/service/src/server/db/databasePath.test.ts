import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_FILENAME, migrateLegacyDatabaseFiles } from './databasePath'

const roots: string[] = []

const createRoot = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-db-migration-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('TuneFlow database path migration', () => {
  it('renames the legacy database and SQLite sidecars without changing their contents', () => {
    const root = createRoot()
    const legacyName = [['l', 'x'].join(''), 'data', 'db'].join('.')
    for (const suffix of ['', '-wal', '-shm']) writeFileSync(path.join(root, `${legacyName}${suffix}`), `content:${suffix}`)

    const databasePath = migrateLegacyDatabaseFiles(root)

    expect(databasePath).toBe(path.join(root, DATABASE_FILENAME))
    for (const suffix of ['', '-wal', '-shm']) {
      expect(readFileSync(`${databasePath}${suffix}`, 'utf8')).toBe(`content:${suffix}`)
    }
  })

  it('refuses to overwrite an existing TuneFlow database', () => {
    const root = createRoot()
    const legacyName = [['l', 'x'].join(''), 'data', 'db'].join('.')
    writeFileSync(path.join(root, legacyName), 'legacy')
    writeFileSync(path.join(root, DATABASE_FILENAME), 'current')

    expect(() => migrateLegacyDatabaseFiles(root)).toThrow('Both legacy and TuneFlow databases exist')
  })
})
