import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parseFile, type IAudioMetadata } from 'music-metadata'
import {
  getAudioRoot,
  getCoverRoot,
  getLibraryResourceIndexRoot,
  getLyricsRoot,
  isPathInside,
} from '../config'

const maxPictureBytes = 20 * 1024 * 1024
const resourceDerivationRevision = '2'
const pictureExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export interface LibraryPictureResource {
  filePath: string
  relativePath: string
  mimeType: string
  byteLength: number
  etag: string
}

export interface LibraryLyricsResource {
  filePath: string
  relativePath: string
}

export interface LibraryDerivedResources {
  picture?: LibraryPictureResource
  lyrics?: LibraryLyricsResource
}

interface ResourceMarker {
  audioRelativePath: string
  signature: string
  picture?: Omit<LibraryPictureResource, 'filePath'>
  lyrics?: Omit<LibraryLyricsResource, 'filePath'>
  pictureMissing: boolean
  lyricsMissing: boolean
}

interface ResourceDependencies {
  parseFile?: typeof parseFile
}

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

const normalizedRelative = (value: string): string => value.split(path.sep).join('/')

const formatLrcTimestamp = (timestamp: number): string => {
  const total = Math.max(0, Math.trunc(timestamp))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor(total % 60_000 / 1_000)
  const milliseconds = total % 1_000
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}]`
}

const synchronizedLyricsText = (metadata: IAudioMetadata): string | undefined => {
  for (const lyrics of metadata.common.lyrics ?? []) {
    const entries = lyrics.syncText?.filter(entry =>
      Number.isFinite(entry.timestamp) && entry.timestamp >= 0 && typeof entry.text === 'string')
    if (entries != null && entries.length > 0) {
      return entries.map(entry => `${formatLrcTimestamp(entry.timestamp)}${entry.text}`).join('\n')
    }
  }
  return undefined
}

export class LibraryResourceStore {
  private readonly audioRoot: string
  private readonly coverRoot: string
  private readonly lyricsRoot: string
  private readonly indexRoot: string
  private readonly tmpRoot: string
  private readonly parse: typeof parseFile
  private readonly pending = new Map<string, Promise<LibraryDerivedResources>>()

  constructor(private readonly storageRoot: string, dependencies: ResourceDependencies = {}) {
    this.audioRoot = getAudioRoot(storageRoot)
    this.coverRoot = getCoverRoot(storageRoot)
    this.lyricsRoot = getLyricsRoot(storageRoot)
    this.indexRoot = getLibraryResourceIndexRoot(storageRoot)
    this.tmpRoot = path.join(storageRoot, 'tmp')
    this.parse = dependencies.parseFile ?? parseFile
    for (const directory of [this.audioRoot, this.coverRoot, this.lyricsRoot, this.indexRoot, this.tmpRoot]) {
      mkdirSync(directory, { recursive: true })
    }
    this.audioRoot = realpathSync(this.audioRoot)
    this.coverRoot = realpathSync(this.coverRoot)
    this.lyricsRoot = realpathSync(this.lyricsRoot)
    this.indexRoot = realpathSync(this.indexRoot)
    this.tmpRoot = realpathSync(this.tmpRoot)
  }

  async ensure(audioFilePath: string): Promise<LibraryDerivedResources> {
    const canonical = realpathSync(audioFilePath)
    if (!isPathInside(this.audioRoot, canonical) || !statSync(canonical).isFile()) {
      throw new Error('Library resource audio path escaped the audio root')
    }
    const current = this.pending.get(canonical)
    if (current != null) return current
    const operation = this.ensureActual(canonical)
    this.pending.set(canonical, operation)
    try {
      return await operation
    } finally {
      if (this.pending.get(canonical) === operation) this.pending.delete(canonical)
    }
  }

  async reconcile(activeAudioFiles: ReadonlySet<string>): Promise<void> {
    const active = new Set([...activeAudioFiles].map(filePath => {
      try { return realpathSync(filePath) } catch { return path.resolve(filePath) }
    }))
    for (const name of readdirSync(this.indexRoot)) {
      if (!name.endsWith('.json')) continue
      const markerPath = path.join(this.indexRoot, name)
      const marker = this.readMarker(markerPath)
      if (marker == null) {
        rmSync(markerPath, { force: true })
        continue
      }
      const audio = path.resolve(this.audioRoot, marker.audioRelativePath)
      if (active.has(audio)) continue
      this.removeMarkerResources(marker)
      rmSync(markerPath, { force: true })
    }
  }

  remove(audioFilePath: string, knownResources: LibraryDerivedResources = {}): void {
    const resolved = path.resolve(audioFilePath)
    if (!isPathInside(this.audioRoot, resolved)) {
      throw new Error('Library resource audio path escaped the audio root')
    }
    if (knownResources.picture != null) {
      const picturePath = path.resolve(knownResources.picture.filePath)
      if (!isPathInside(this.coverRoot, picturePath)) throw new Error('Library picture path escaped the cover root')
      rmSync(picturePath, { force: true })
    }
    if (knownResources.lyrics != null) {
      const lyricsPath = path.resolve(knownResources.lyrics.filePath)
      if (!isPathInside(this.lyricsRoot, lyricsPath)) throw new Error('Library lyrics path escaped the lyrics root')
      rmSync(lyricsPath, { force: true })
    }
    const audioRelativePath = normalizedRelative(path.relative(this.audioRoot, resolved))
    const markerPath = this.markerPath(audioRelativePath)
    const marker = this.readMarker(markerPath)
    if (marker != null) this.removeMarkerResources(marker)
    rmSync(markerPath, { force: true })
  }

  private async ensureActual(audioFilePath: string): Promise<LibraryDerivedResources> {
    const audioRelativePath = normalizedRelative(path.relative(this.audioRoot, audioFilePath))
    const markerPath = this.markerPath(audioRelativePath)
    const stat = statSync(audioFilePath)
    const sidecarPath = this.sidecarPath(audioFilePath)
    const sidecarSignature = existsSync(sidecarPath)
      ? (() => {
          const sidecarStat = statSync(sidecarPath)
          return `${sidecarStat.size}\0${sidecarStat.mtimeMs}`
        })()
      : 'missing'
    const signature = `${resourceDerivationRevision}\0${stat.size}\0${stat.mtimeMs}\0${sidecarSignature}`
    const previous = this.readMarker(markerPath)
    if (previous?.audioRelativePath === audioRelativePath &&
      previous.signature === signature && this.markerFilesExist(previous)) {
      return this.resourcesFromMarker(previous)
    }

    const metadata = await this.parse(audioFilePath, { duration: false, skipCovers: false })
    const picture = this.pictureFromMetadata(audioRelativePath, metadata)
    const lyrics = this.lyricsFromMetadata(audioFilePath, audioRelativePath, metadata)
    if (picture != null) this.atomicWrite(this.resolveStoredPath(picture.relativePath, this.coverRoot), picture.bytes)
    if (lyrics != null) this.atomicWrite(this.resolveStoredPath(lyrics.relativePath, this.lyricsRoot), lyrics.text)

    const marker: ResourceMarker = {
      audioRelativePath,
      signature,
      picture: picture == null ? undefined : {
        relativePath: picture.relativePath,
        mimeType: picture.mimeType,
        byteLength: picture.bytes.length,
        etag: sha256(picture.bytes),
      },
      lyrics: lyrics == null ? undefined : { relativePath: lyrics.relativePath },
      pictureMissing: picture == null,
      lyricsMissing: lyrics == null,
    }
    this.atomicWrite(markerPath, JSON.stringify(marker))
    if (previous != null) this.removeReplacedResources(previous, marker)
    return this.resourcesFromMarker(marker)
  }

  private pictureFromMetadata(audioRelativePath: string, metadata: IAudioMetadata): {
    relativePath: string
    mimeType: string
    bytes: Uint8Array
  } | undefined {
    const picture = metadata.common.picture?.find(candidate => {
      const extension = pictureExtensions.get(candidate.format.toLowerCase())
      return extension != null && candidate.data.byteLength > 0 && candidate.data.byteLength <= maxPictureBytes
    })
    if (picture == null) return undefined
    const mimeType = picture.format.toLowerCase()
    const extension = pictureExtensions.get(mimeType)!
    return {
      relativePath: normalizedRelative(path.join('cover', `${audioRelativePath}.${extension}`)),
      mimeType,
      bytes: picture.data,
    }
  }

  private lyricsFromMetadata(audioFilePath: string, audioRelativePath: string, metadata: IAudioMetadata): {
    relativePath: string
    text: string
  } | undefined {
    let text = synchronizedLyricsText(metadata) ?? metadata.common.lyrics?.map(value => value.text?.trim()).find(value => value != null && value !== '')
    if (text == null) {
      const sidecar = this.sidecarPath(audioFilePath)
      if (existsSync(sidecar)) text = readFileSync(sidecar, 'utf8').replace(/^\ufeff/, '').trim()
    }
    text = text?.replace(/^\ufeff/, '').trim()
    return text == null || text === '' ? undefined : {
      relativePath: normalizedRelative(path.join('lyrics', `${audioRelativePath}.lrc`)),
      text,
    }
  }

  private markerPath(audioRelativePath: string): string {
    return path.join(this.indexRoot, `${sha256(audioRelativePath)}.json`)
  }

  private sidecarPath(audioFilePath: string): string {
    return audioFilePath.slice(0, -path.extname(audioFilePath).length) + '.lrc'
  }

  private readMarker(markerPath: string): ResourceMarker | undefined {
    if (!existsSync(markerPath)) return undefined
    try {
      const value = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<ResourceMarker>
      if (typeof value.audioRelativePath !== 'string' || typeof value.signature !== 'string' ||
        typeof value.pictureMissing !== 'boolean' || typeof value.lyricsMissing !== 'boolean') return undefined
      return value as ResourceMarker
    } catch {
      return undefined
    }
  }

  private markerFilesExist(marker: ResourceMarker): boolean {
    if (!marker.pictureMissing && (marker.picture == null || !existsSync(this.resolveStoredPath(marker.picture.relativePath, this.coverRoot)))) return false
    if (!marker.lyricsMissing && (marker.lyrics == null || !existsSync(this.resolveStoredPath(marker.lyrics.relativePath, this.lyricsRoot)))) return false
    return true
  }

  private resourcesFromMarker(marker: ResourceMarker): LibraryDerivedResources {
    return {
      picture: marker.picture == null ? undefined : {
        ...marker.picture,
        filePath: this.resolveStoredPath(marker.picture.relativePath, this.coverRoot),
      },
      lyrics: marker.lyrics == null ? undefined : {
        ...marker.lyrics,
        filePath: this.resolveStoredPath(marker.lyrics.relativePath, this.lyricsRoot),
      },
    }
  }

  private resolveStoredPath(relativePath: string, expectedRoot: string): string {
    const resolved = path.resolve(this.storageRoot, relativePath)
    if (!isPathInside(expectedRoot, resolved)) throw new Error('Library resource path escaped its root')
    return resolved
  }

  private atomicWrite(target: string, content: string | Uint8Array): void {
    mkdirSync(path.dirname(target), { recursive: true })
    const temporary = path.join(this.tmpRoot, `library-resource-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
    writeFileSync(temporary, content)
    const descriptor = openSync(temporary, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    renameSync(temporary, target)
  }

  private removeMarkerResources(marker: ResourceMarker): void {
    if (marker.picture != null) rmSync(this.resolveStoredPath(marker.picture.relativePath, this.coverRoot), { force: true })
    if (marker.lyrics != null) rmSync(this.resolveStoredPath(marker.lyrics.relativePath, this.lyricsRoot), { force: true })
  }

  private removeReplacedResources(previous: ResourceMarker, current: ResourceMarker): void {
    if (previous.picture != null && previous.picture.relativePath !== current.picture?.relativePath) {
      rmSync(this.resolveStoredPath(previous.picture.relativePath, this.coverRoot), { force: true })
    }
    if (previous.lyrics != null && previous.lyrics.relativePath !== current.lyrics?.relativePath) {
      rmSync(this.resolveStoredPath(previous.lyrics.relativePath, this.lyricsRoot), { force: true })
    }
  }
}
