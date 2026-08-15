import { accessSync, constants, lstatSync, mkdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export interface ServerOptions {
  storageRoot: string
  webRoot: string
  host: string
  port: number
}

export const getAudioRoot = (storageRoot: string): string => path.join(storageRoot, 'audio')
export const getCoverRoot = (storageRoot: string): string => path.join(storageRoot, 'cover')
export const getLyricsRoot = (storageRoot: string): string => path.join(storageRoot, 'lyrics')
export const getLibraryResourceIndexRoot = (storageRoot: string): string => path.join(storageRoot, 'library-resource-index')

const ensureWritableStorage = (storageRoot: string) => {
  mkdirSync(storageRoot, { recursive: true })
  for (const name of ['audio', 'cover', 'lyrics', 'library-resource-index', 'sources', 'tmp', 'logs', 'backups']) {
    mkdirSync(path.join(storageRoot, name), { recursive: true })
  }
  accessSync(storageRoot, constants.W_OK)
  const probe = path.join(storageRoot, `.tuneflow-write-probe-${process.pid}-${Date.now()}`)
  writeFileSync(probe, '')
  unlinkSync(probe)
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

export const normalizeServerOptions = (options: ServerOptions): ServerOptions => {
  const storageRoot = path.resolve(options.storageRoot)
  const webRoot = path.resolve(options.webRoot)
  ensureWritableStorage(storageRoot)
  return { ...options, storageRoot: realpathSync(storageRoot), webRoot }
}

export const loadServerOptions = (): ServerOptions => normalizeServerOptions({
  storageRoot: process.env.TUNEFLOW_STORAGE_ROOT ?? './data',
  webRoot: process.env.TUNEFLOW_WEB_ROOT ?? './dist/web',
  host: process.env.TUNEFLOW_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.TUNEFLOW_PORT ?? '3124', 10),
})
