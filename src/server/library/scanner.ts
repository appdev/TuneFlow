import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { isPathInside } from '../config'

const EXTENSIONS = new Set(['.ape', '.flac', '.mp3', '.wav'])

const firstNonEmpty = (...values: Array<string | undefined>): string => values.find(value => value != null && value !== '') ?? ''

export interface LibraryTrackDto {
  id: string
  name: string
  singer: string
  source: 'local'
  interval: string
  meta: { songId: string, albumName: string, ext: string, streamUrl: string }
  musicInfo: { id: string, name: string, singer: string, source: 'local', interval: string, meta: { songId: string, albumName: string, ext: string, streamUrl: string } }
  size: number
  extension: string
  codec?: string
  streamUrl: string
}

interface PrivateEntry { dto: LibraryTrackDto, filePath: string }

const formatDuration = (seconds?: number): string => {
  if (seconds == null || !Number.isFinite(seconds)) return '00:00'
  const whole = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export class LibraryScanner {
  private entries = new Map<string, PrivateEntry>()
  constructor(private readonly storageRoot: string, private readonly getRoots: () => string[]) {}

  list(): LibraryTrackDto[] { return [...this.entries.values()].map(entry => entry.dto) }
  get(id: string): PrivateEntry | undefined { return this.entries.get(id) }
  findByFilePath(filePath: string): LibraryTrackDto | undefined {
    let target: string
    try { target = realpathSync(filePath) } catch { return undefined }
    return [...this.entries.values()].find(entry => entry.filePath === target)?.dto
  }

  async refresh(): Promise<LibraryTrackDto[]> {
    const entries = new Map<string, PrivateEntry>()
    const canonicalStorage = realpathSync(this.storageRoot)
    for (const configuredRoot of this.getRoots()) {
      if (!isPathInside(canonicalStorage, configuredRoot)) continue
      let root: string
      try { root = realpathSync(configuredRoot) } catch { continue }
      if (!isPathInside(canonicalStorage, root)) continue
      await this.scanDirectory(root, root, entries)
    }
    this.entries = entries
    return this.list()
  }

  private async scanDirectory(root: string, directory: string, entries: Map<string, PrivateEntry>): Promise<void> {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.name.endsWith('.part') || entry.name.endsWith('.tuneflowtmp')) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await this.scanDirectory(root, candidate, entries)
        continue
      }
      if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const filePath = realpathSync(candidate)
      if (!isPathInside(root, filePath) || !lstatSync(filePath).isFile()) continue
      const stat = statSync(filePath)
      const relative = path.relative(root, filePath).split(path.sep).join('/')
      const identity = `${path.relative(this.storageRoot, root).split(path.sep).join('/')}/${relative}\0${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`
      const id = createHash('sha256').update(identity).digest('hex')
      let metadata: Awaited<ReturnType<typeof parseFile>> | undefined
      try { metadata = await parseFile(filePath, { duration: true, skipCovers: true }) } catch {}
      const extension = path.extname(filePath).slice(1).toLowerCase()
      const name = firstNonEmpty(metadata?.common.title, path.basename(filePath, path.extname(filePath)))
      const singer = firstNonEmpty(metadata?.common.artist, metadata?.common.artists?.join('、'))
      const interval = formatDuration(metadata?.format.duration)
      const streamUrl = `/api/v1/library/tracks/${encodeURIComponent(id)}/stream`
      const meta = { songId: id, albumName: metadata?.common.album ?? '', ext: extension, streamUrl }
      const musicInfo = { id, name, singer, source: 'local' as const, interval, meta }
      const dto: LibraryTrackDto = {
        ...musicInfo,
        musicInfo,
        size: stat.size,
        extension,
        codec: metadata?.format.codec,
        streamUrl,
      }
      entries.set(id, { dto, filePath })
    }
  }
}
