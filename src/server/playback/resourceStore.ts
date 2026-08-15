import { randomBytes } from 'node:crypto'

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 256
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

export interface StoredPicture { bytes: Uint8Array, mimeType: string, expiresAt: number }

export interface PlaybackResourceStoreOptions {
  now?: () => number
  ttlMs?: number
  maxEntries?: number
  maxBytes?: number
}

interface PictureEntry extends StoredPicture { createdAt: number }

export class PlaybackResourceStore {
  private readonly pictures = new Map<string, PictureEntry>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private totalBytes = 0

  constructor(options: PlaybackResourceStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  putPicture(value: Omit<StoredPicture, 'expiresAt'>): { token: string, expiresAt: number } {
    this.pruneExpired()
    const token = randomBytes(32).toString('hex')
    const createdAt = this.now()
    const expiresAt = createdAt + this.ttlMs
    const bytes = Uint8Array.from(value.bytes)
    this.pictures.set(token, { bytes, mimeType: value.mimeType, expiresAt, createdAt })
    this.totalBytes += bytes.byteLength
    this.pruneCapacity()
    return { token, expiresAt }
  }

  getPicture(token: string): StoredPicture | undefined {
    const value = this.pictures.get(token)
    if (value == null) return undefined
    if (value.expiresAt <= this.now()) {
      this.remove(token, value)
      return undefined
    }
    return { bytes: Uint8Array.from(value.bytes), mimeType: value.mimeType, expiresAt: value.expiresAt }
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [token, value] of this.pictures) {
      if (value.expiresAt <= now) this.remove(token, value)
    }
  }

  private pruneCapacity(): void {
    while (this.pictures.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = [...this.pictures.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt)[0]
      if (oldest == null) return
      this.remove(oldest[0], oldest[1])
    }
  }

  private remove(token: string, value: PictureEntry): void {
    if (!this.pictures.delete(token)) return
    this.totalBytes -= value.bytes.byteLength
  }
}
