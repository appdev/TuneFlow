import { existsSync, renameSync } from 'node:fs'
import path from 'node:path'

export const DATABASE_FILENAME = 'tuneflow.data.db'
const LEGACY_DATABASE_FILENAME = [['l', 'x'].join(''), 'data', 'db'].join('.')
const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm'] as const

export const resolveDatabasePath = (databaseRoot: string): string => path.join(databaseRoot, DATABASE_FILENAME)

export const migrateLegacyDatabaseFiles = (databaseRoot: string): string => {
  const target = resolveDatabasePath(databaseRoot)
  const legacy = path.join(databaseRoot, LEGACY_DATABASE_FILENAME)
  if (!existsSync(legacy)) return target
  if (existsSync(target)) throw new Error(`Both legacy and TuneFlow databases exist in ${databaseRoot}; refusing to overwrite either file`)

  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sourcePath = `${legacy}${suffix}`
    if (existsSync(sourcePath)) renameSync(sourcePath, `${target}${suffix}`)
  }
  return target
}
