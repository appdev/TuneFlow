import { accessSync, constants, lstatSync, mkdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { ensureSplitLayoutMarker } from './storage/layoutMarker'

export interface ServerOptions {
  storage: StorageLayout
  webRoot: string
  host: string
  port: number
}

export interface LegacyServerOptions {
  storageRoot: string
  webRoot: string
  host: string
  port: number
}

export type ServerOptionsInput = ServerOptions | LegacyServerOptions

export interface StorageLayout {
  mode: 'split' | 'legacy'
  configRoot: string
  databaseRoot: string
  sourceRoot: string
  backupRoot: string
  mediaRoot: string
  cacheRoot: string
  mediaIdentityPrefix: string
  libraryResources: {
    coverRoot: string
    lyricsRoot: string
    indexRoot: string
  }
  tempRoot: string
}

export const getAudioRoot = (storageRoot: string): string => path.join(storageRoot, 'audio')
export const getCoverRoot = (storageRoot: string): string => path.join(storageRoot, 'cover')
export const getLyricsRoot = (storageRoot: string): string => path.join(storageRoot, 'lyrics')
export const getLibraryResourceIndexRoot = (storageRoot: string): string => path.join(storageRoot, 'library-resource-index')

const ensureWritableRoot = (root: string): string => {
  mkdirSync(root, { recursive: true })
  accessSync(root, constants.W_OK)
  const probe = path.join(root, `.tuneflow-write-probe-${process.pid}-${Date.now()}`)
  writeFileSync(probe, '')
  unlinkSync(probe)
  return realpathSync(root)
}

const ensureLegacyStorage = (storageRoot: string): string => {
  const root = ensureWritableRoot(storageRoot)
  for (const name of ['audio', 'cover', 'lyrics', 'library-resource-index', 'sources', 'tmp', 'backups']) {
    mkdirSync(path.join(root, name), { recursive: true })
  }
  return root
}

export const isPathInside = (storageRoot: string, candidate: string): boolean => {
  const canonicalRoot = realpathSync(storageRoot)
  let canonicalCandidate = path.resolve(candidate)
  const suffix: string[] = []
  while (true) {
    let entry: ReturnType<typeof lstatSync> | undefined
    try {
      entry = lstatSync(canonicalCandidate)
    } catch {}
    if (entry != null) {
      try {
        canonicalCandidate = realpathSync(canonicalCandidate)
        break
      } catch {
        return false
      }
    }
    const parent = path.dirname(canonicalCandidate)
    if (parent === canonicalCandidate) return false
    suffix.unshift(path.basename(canonicalCandidate))
    canonicalCandidate = parent
  }
  canonicalCandidate = path.join(realpathSync(canonicalCandidate), ...suffix)
  const relative = path.relative(canonicalRoot, canonicalCandidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const canonicalProspectivePath = (input: string): string => {
  let candidate = path.resolve(input)
  const suffix: string[] = []
  while (true) {
    try {
      return path.join(realpathSync(candidate), ...suffix)
    } catch {
      const parent = path.dirname(candidate)
      if (parent === candidate) throw new Error(`Unable to resolve storage root: ${input}`)
      suffix.unshift(path.basename(candidate))
      candidate = parent
    }
  }
}

const overlaps = (left: string, right: string): boolean => {
  const relative = path.relative(left, right)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

export const createLegacyStorageLayout = (input: string): StorageLayout => {
  const root = ensureLegacyStorage(path.resolve(input))
  return {
    mode: 'legacy',
    configRoot: root,
    databaseRoot: root,
    sourceRoot: path.join(root, 'sources'),
    backupRoot: path.join(root, 'backups'),
    mediaRoot: path.join(root, 'audio'),
    cacheRoot: root,
    mediaIdentityPrefix: 'audio',
    libraryResources: {
      coverRoot: path.join(root, 'cover'),
      lyricsRoot: path.join(root, 'lyrics'),
      indexRoot: path.join(root, 'library-resource-index'),
    },
    tempRoot: path.join(root, 'tmp'),
  }
}

const splitVariables = ['TUNEFLOW_CONFIG_ROOT', 'TUNEFLOW_MEDIA_ROOT', 'TUNEFLOW_CACHE_ROOT', 'TUNEFLOW_TEMP_ROOT'] as const

export const resolveStorageLayout = (env: NodeJS.ProcessEnv): StorageLayout => {
  const legacy = env.TUNEFLOW_STORAGE_ROOT
  const selectedSplit = splitVariables.filter(name => env[name] != null && env[name] !== '')
  if (legacy != null && legacy !== '' && selectedSplit.length > 0) {
    throw new Error('TUNEFLOW_STORAGE_ROOT cannot be combined with split storage variables')
  }
  if (selectedSplit.length > 0 && selectedSplit.length !== splitVariables.length) {
    const missing = splitVariables.filter(name => env[name] == null || env[name] === '')
    throw new Error(`Missing split storage variables: ${missing.join(', ')}`)
  }
  if (selectedSplit.length === 0) return createLegacyStorageLayout(legacy == null || legacy === '' ? './data' : legacy)

  const prospective = splitVariables.map(name => canonicalProspectivePath(env[name]!))
  for (let left = 0; left < prospective.length; left += 1) {
    for (let right = left + 1; right < prospective.length; right += 1) {
      if (overlaps(prospective[left], prospective[right]) || overlaps(prospective[right], prospective[left])) {
        throw new Error('Split storage roots must be distinct and non-overlapping')
      }
    }
  }

  const [configRoot, mediaRoot, cacheRoot, tempRoot] = prospective.map(ensureWritableRoot)
  ensureSplitLayoutMarker(configRoot)
  const databaseRoot = path.join(configRoot, 'database')
  const sourceRoot = path.join(configRoot, 'sources')
  const backupRoot = path.join(configRoot, 'backups')
  const coverRoot = path.join(cacheRoot, 'library', 'cover')
  const lyricsRoot = path.join(cacheRoot, 'library', 'lyrics')
  const indexRoot = path.join(cacheRoot, 'library', 'index')
  for (const directory of [databaseRoot, sourceRoot, backupRoot, coverRoot, lyricsRoot, indexRoot]) {
    mkdirSync(directory, { recursive: true })
  }
  return {
    mode: 'split',
    configRoot,
    databaseRoot,
    sourceRoot,
    backupRoot,
    mediaRoot,
    cacheRoot,
    mediaIdentityPrefix: '',
    libraryResources: { coverRoot, lyricsRoot, indexRoot },
    tempRoot,
  }
}

export const normalizeServerOptions = (options: ServerOptionsInput): ServerOptions => {
  const webRoot = path.resolve(options.webRoot)
  const storage = 'storage' in options ? options.storage : createLegacyStorageLayout(options.storageRoot)
  return { storage, webRoot, host: options.host, port: options.port }
}

export const loadServerOptions = (): ServerOptions => normalizeServerOptions({
  storage: resolveStorageLayout(process.env),
  webRoot: process.env.TUNEFLOW_WEB_ROOT ?? './dist/web',
  host: process.env.TUNEFLOW_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.TUNEFLOW_PORT ?? '3124', 10),
})
