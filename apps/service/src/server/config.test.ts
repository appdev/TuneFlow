import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLegacyStorageLayout, resolveStorageLayout } from './config'

const roots: string[] = []
const createRoot = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-storage-layout-'))
  roots.push(root)
  return root
}

const splitEnvironment = (root: string): NodeJS.ProcessEnv => ({
  TUNEFLOW_CONFIG_ROOT: path.join(root, 'config'),
  TUNEFLOW_MEDIA_ROOT: path.join(root, 'music'),
  TUNEFLOW_CACHE_ROOT: path.join(root, 'cache'),
  TUNEFLOW_TEMP_ROOT: path.join(root, 'tmp'),
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('storage layout', () => {
  it('rejects mixed legacy and split variables before creating storage', () => {
    const root = createRoot()
    expect(() => resolveStorageLayout({
      TUNEFLOW_STORAGE_ROOT: path.join(root, 'legacy'),
      ...splitEnvironment(root),
    })).toThrow('TUNEFLOW_STORAGE_ROOT cannot be combined with split storage variables')
    expect(existsSync(path.join(root, 'legacy'))).toBe(false)
    expect(existsSync(path.join(root, 'config'))).toBe(false)
  })

  it('reports every missing split variable before creating storage', () => {
    const root = createRoot()
    expect(() => resolveStorageLayout({ TUNEFLOW_CONFIG_ROOT: path.join(root, 'config') }))
      .toThrow('Missing split storage variables: TUNEFLOW_MEDIA_ROOT, TUNEFLOW_CACHE_ROOT, TUNEFLOW_TEMP_ROOT')
    expect(existsSync(path.join(root, 'config'))).toBe(false)
  })

  it('maps legacy mode to the existing directory and identity contract', () => {
    const root = createRoot()
    const canonicalRoot = realpathSync(root)
    const layout = createLegacyStorageLayout(root)
    expect(layout).toMatchObject({
      mode: 'legacy',
      configRoot: canonicalRoot,
      databaseRoot: canonicalRoot,
      sourceRoot: path.join(canonicalRoot, 'sources'),
      backupRoot: path.join(canonicalRoot, 'backups'),
      mediaRoot: path.join(canonicalRoot, 'audio'),
      cacheRoot: canonicalRoot,
      mediaIdentityPrefix: 'audio',
      tempRoot: path.join(canonicalRoot, 'tmp'),
      libraryResources: {
        coverRoot: path.join(canonicalRoot, 'cover'),
        lyricsRoot: path.join(canonicalRoot, 'lyrics'),
        indexRoot: path.join(canonicalRoot, 'library-resource-index'),
      },
    })
    expect(existsSync(path.join(root, 'logs'))).toBe(false)
  })

  it('treats an empty legacy root as unset', () => {
    const root = createRoot()
    const previous = process.cwd()
    try {
      process.chdir(root)
      expect(resolveStorageLayout({ TUNEFLOW_STORAGE_ROOT: '' }).configRoot).toBe(realpathSync(path.join(root, 'data')))
    } finally {
      process.chdir(previous)
    }
  })

  it('maps split roots to component-owned paths and writes a private marker', () => {
    const root = createRoot()
    const canonicalRoot = realpathSync(root)
    const layout = resolveStorageLayout(splitEnvironment(root))
    expect(layout).toMatchObject({
      mode: 'split',
      databaseRoot: path.join(canonicalRoot, 'config', 'database'),
      sourceRoot: path.join(canonicalRoot, 'config', 'sources'),
      backupRoot: path.join(canonicalRoot, 'config', 'backups'),
      mediaRoot: path.join(canonicalRoot, 'music'),
      cacheRoot: path.join(canonicalRoot, 'cache'),
      mediaIdentityPrefix: '',
      tempRoot: path.join(canonicalRoot, 'tmp'),
      libraryResources: {
        coverRoot: path.join(canonicalRoot, 'cache', 'library', 'cover'),
        lyricsRoot: path.join(canonicalRoot, 'cache', 'library', 'lyrics'),
        indexRoot: path.join(canonicalRoot, 'cache', 'library', 'index'),
      },
    })
    expect(JSON.parse(readFileSync(path.join(root, 'config', 'storage-layout.json'), 'utf8'))).toEqual({ version: 1 })
  })

  it('rejects overlapping split roots before creating them', () => {
    const root = createRoot()
    const env = splitEnvironment(root)
    env.TUNEFLOW_MEDIA_ROOT = path.join(root, 'config', 'music')
    expect(() => resolveStorageLayout(env)).toThrow('Split storage roots must be distinct and non-overlapping')
    expect(existsSync(path.join(root, 'config'))).toBe(false)
  })

  it('detects overlap through an existing symlink', () => {
    const root = createRoot()
    const actual = path.join(root, 'actual')
    mkdirSync(actual)
    symlinkSync(actual, path.join(root, 'linked'))
    const env = splitEnvironment(root)
    env.TUNEFLOW_CONFIG_ROOT = path.join(root, 'linked')
    env.TUNEFLOW_MEDIA_ROOT = path.join(actual, 'music')
    expect(() => resolveStorageLayout(env)).toThrow('Split storage roots must be distinct and non-overlapping')
    expect(existsSync(path.join(actual, 'music'))).toBe(false)
  })

  it('rejects split config state without a layout marker', () => {
    const root = createRoot()
    mkdirSync(path.join(root, 'config'))
    writeFileSync(path.join(root, 'config', 'unexpected.db'), 'state')
    expect(() => resolveStorageLayout(splitEnvironment(root))).toThrow('Split config root contains state without storage-layout.json')
  })

  it('rejects an unsupported layout marker version', () => {
    const root = createRoot()
    mkdirSync(path.join(root, 'config'))
    writeFileSync(path.join(root, 'config', 'storage-layout.json'), '{"version":2}')
    expect(() => resolveStorageLayout(splitEnvironment(root))).toThrow('Unsupported storage layout version: 2')
  })
})
