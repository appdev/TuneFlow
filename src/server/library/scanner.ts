import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { isPathInside } from '../config'
import { makeFileName } from '../downloads/filenames'
import { isSameMusic } from '../downloads/matching'
import type { DownloadExtension, DownloadFileIntegrity, DownloadFileNamePattern } from '../downloads/types'
import type { LibraryDerivedResources, LibraryResourceStore } from './resources'

const EXTENSIONS = new Set(['.ape', '.flac', '.mp3', '.wav'])

const firstNonEmpty = (...values: Array<string | undefined>): string => values.find(value => value != null && value !== '') ?? ''

export interface LibraryTrackDto {
  id: string
  name: string
  singer: string
  source: 'local'
  interval: string
  meta: { songId: string, albumName: string, ext: string, streamUrl: string, lyricsUrl?: string }
  musicInfo: {
    id: string
    name: string
    singer: string
    source: 'local'
    interval: string
    pic?: string
    meta: { songId: string, albumName: string, ext: string, streamUrl: string, lyricsUrl?: string }
  }
  size: number
  extension: string
  codec?: string
  streamUrl: string
  pictureUrl?: string
  lyricsUrl?: string
}

interface PrivateEntry { dto: LibraryTrackDto, filePath: string, resources: LibraryDerivedResources }
interface CachedMetadata {
  signature: string
  valid: boolean
  name: string
  singer: string
  albumName: string
  interval: string
  codec?: string
}

const FILE_NAME_PATTERNS: DownloadFileNamePattern[] = ['歌名 - 歌手', '歌手 - 歌名', '歌名']
const DOWNLOAD_EXTENSIONS: DownloadExtension[] = ['ape', 'flac', 'wav', 'mp3']

const normalizedFileName = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/ \(\d+\)(?=\.[^.]+$)/, '')

const formatDuration = (seconds?: number): string => {
  if (seconds == null || !Number.isFinite(seconds)) return '00:00'
  const whole = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

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

export class LibraryScanner {
  private entries = new Map<string, PrivateEntry>()
  private readonly metadataCache = new Map<string, CachedMetadata>()
  private refreshPromise: Promise<LibraryTrackDto[]> | null = null
  constructor(
    private readonly storageRoot: string,
    private readonly getRoots: () => string[],
    private readonly getExpectedIntegrity: (filePath: string) => DownloadFileIntegrity | undefined = () => undefined,
    private readonly resourceStore?: LibraryResourceStore,
  ) {}

  list(): LibraryTrackDto[] { return [...this.entries.values()].map(entry => entry.dto) }
  get(id: string): PrivateEntry | undefined { return this.entries.get(id) }
  findByFilePath(filePath: string): LibraryTrackDto | undefined {
    let target: string
    try { target = realpathSync(filePath) } catch { return undefined }
    return [...this.entries.values()].find(entry => entry.filePath === target)?.dto
  }

  async findMatchingFile(musicInfo: unknown): Promise<{ filePath: string, track: LibraryTrackDto } | undefined> {
    await this.refresh()
    const direct = [...this.entries.values()].find(entry => isSameMusic(entry.dto, musicInfo))
    if (direct != null) return { filePath: direct.filePath, track: direct.dto }

    if (typeof musicInfo !== 'object' || musicInfo == null) return undefined
    const info = musicInfo as Partial<TuneFlow.Music.MusicInfoOnline>
    if (typeof info.name !== 'string' || typeof info.singer !== 'string') return undefined
    const expected = new Set(FILE_NAME_PATTERNS.flatMap(pattern => DOWNLOAD_EXTENSIONS.map(extension =>
      normalizedFileName(makeFileName(pattern, info.name!, info.singer!, extension)),
    )))
    const byName = [...this.entries.values()].find(entry => expected.has(normalizedFileName(path.basename(entry.filePath))))
    return byName == null ? undefined : { filePath: byName.filePath, track: byName.dto }
  }

  async refresh(): Promise<LibraryTrackDto[]> {
    if (this.refreshPromise != null) return this.refreshPromise
    this.refreshPromise = this.refreshActual()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshActual(): Promise<LibraryTrackDto[]> {
    const entries = new Map<string, PrivateEntry>()
    const seenFiles = new Set<string>()
    const canonicalStorage = realpathSync(this.storageRoot)
    for (const configuredRoot of this.getRoots()) {
      if (!isPathInside(canonicalStorage, configuredRoot)) continue
      let root: string
      try { root = realpathSync(configuredRoot) } catch { continue }
      if (!isPathInside(canonicalStorage, root)) continue
      await this.scanDirectory(root, root, entries, seenFiles)
    }
    this.entries = entries
    for (const filePath of this.metadataCache.keys()) {
      if (!seenFiles.has(filePath)) this.metadataCache.delete(filePath)
    }
    await this.resourceStore?.reconcile(seenFiles)
    return this.list()
  }

  private async scanDirectory(root: string, directory: string, entries: Map<string, PrivateEntry>, seenFiles: Set<string>): Promise<void> {
    let directoryEntries: Dirent[]
    try {
      directoryEntries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch { return }
    for (const entry of directoryEntries) {
      const candidate = path.join(directory, entry.name)
      if (entry.name.endsWith('.part') || entry.name.endsWith('.tuneflowtmp')) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await this.scanDirectory(root, candidate, entries, seenFiles)
        continue
      }
      if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      let filePath: string
      let stat: ReturnType<typeof statSync>
      try {
        filePath = realpathSync(candidate)
        if (!isPathInside(root, filePath) || !lstatSync(filePath).isFile()) continue
        stat = statSync(filePath)
      } catch { continue }
      if (stat.size === 0) continue
      seenFiles.add(filePath)
      const expectedIntegrity = this.getExpectedIntegrity(filePath)
      if (expectedIntegrity != null &&
        (stat.size !== expectedIntegrity.size || sha256File(filePath) !== expectedIntegrity.sha256)) continue
      const relative = path.relative(root, filePath).split(path.sep).join('/')
      const identity = `${path.relative(this.storageRoot, root).split(path.sep).join('/')}/${relative}\0${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`
      const id = createHash('sha256').update(identity).digest('hex')
      const extension = path.extname(filePath).slice(1).toLowerCase()
      const signature = `${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`
      let cached = this.metadataCache.get(filePath)
      if (cached?.signature !== signature) {
        let metadata: Awaited<ReturnType<typeof parseFile>> | undefined
        try { metadata = await parseFile(filePath, { duration: true, skipCovers: true }) } catch {}
        cached = {
          signature,
          valid: metadata?.format.container != null && metadata.format.codec != null,
          name: firstNonEmpty(metadata?.common.title, path.basename(filePath, path.extname(filePath))),
          singer: firstNonEmpty(metadata?.common.artist, metadata?.common.artists?.join('、')),
          albumName: metadata?.common.album ?? '',
          interval: formatDuration(metadata?.format.duration),
          codec: metadata?.format.codec,
        }
        this.metadataCache.set(filePath, cached)
      }
      if (!cached.valid) continue
      const resources = await this.resourceStore?.ensure(filePath) ?? {}
      const { name, singer, albumName, interval, codec } = cached
      const streamUrl = `/api/v1/library/tracks/${encodeURIComponent(id)}/stream`
      const pictureUrl = resources.picture == null ? undefined : `/api/v1/library/tracks/${encodeURIComponent(id)}/picture`
      const lyricsUrl = resources.lyrics == null ? undefined : `/api/v1/library/tracks/${encodeURIComponent(id)}/lyrics`
      const meta = { songId: id, albumName, ext: extension, streamUrl, lyricsUrl }
      const musicInfo = { id, name, singer, source: 'local' as const, interval, pic: pictureUrl, meta }
      const dto: LibraryTrackDto = {
        ...musicInfo,
        musicInfo,
        size: stat.size,
        extension,
        codec,
        streamUrl,
        pictureUrl,
        lyricsUrl,
      }
      entries.set(id, { dto, filePath, resources })
    }
  }
}
