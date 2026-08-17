import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface SplitLayoutMarker { version: 1, migratedAt?: string, sourceManifestDigest?: string }

const markerName = 'storage-layout.json'

export const readSplitLayoutMarker = (configRoot: string): SplitLayoutMarker | undefined => {
  const markerPath = path.join(configRoot, markerName)
  if (!existsSync(markerPath)) return undefined
  let value: unknown
  try {
    value = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch {
    throw new Error('Invalid storage-layout.json')
  }
  const version = typeof value === 'object' && value != null && 'version' in value
    ? (value as { version?: unknown }).version
    : undefined
  if (version !== 1) throw new Error(`Unsupported storage layout version: ${String(version)}`)
  const marker = value as SplitLayoutMarker
  if (marker.migratedAt != null && typeof marker.migratedAt !== 'string') throw new Error('Invalid storage-layout.json')
  if (marker.sourceManifestDigest != null && (typeof marker.sourceManifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sourceManifestDigest))) {
    throw new Error('Invalid storage-layout.json')
  }
  return marker
}

export const ensureSplitLayoutMarker = (configRoot: string): SplitLayoutMarker => {
  const current = readSplitLayoutMarker(configRoot)
  if (current != null) return current
  if (readdirSync(configRoot).length > 0) {
    throw new Error('Split config root contains state without storage-layout.json')
  }
  return writeSplitLayoutMarker(configRoot)
}

export const writeSplitLayoutMarker = (configRoot: string, metadata: Omit<SplitLayoutMarker, 'version'> = {}): SplitLayoutMarker => {
  const markerPath = path.join(configRoot, markerName)
  if (existsSync(markerPath)) return readSplitLayoutMarker(configRoot)!
  const temporaryPath = path.join(configRoot, `.${markerName}.${randomUUID()}.tmp`)
  try {
    const marker: SplitLayoutMarker = { version: 1, ...metadata }
    writeFileSync(temporaryPath, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const descriptor = openSync(temporaryPath, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    renameSync(temporaryPath, markerPath)
    const directory = openSync(configRoot, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally {
    rmSync(temporaryPath, { force: true })
  }
  return { version: 1, ...metadata }
}
