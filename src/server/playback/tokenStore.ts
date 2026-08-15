import { randomBytes } from 'node:crypto'
import type { StreamCandidate } from './bundleResolver'

const TOKEN_TTL_MS = 5 * 60 * 1000
const MAX_TOKENS = 1000
const FORWARDABLE_SOURCE_HEADERS = new Set([
  'accept', 'accept-language', 'authorization', 'cookie', 'origin', 'referer', 'user-agent',
])

export interface PlaybackToken {
  url: string
  headers: Record<string, string>
  candidates: StreamCandidate[]
  expiresAt: number
}

export interface TokenStoreOptions {
  now?: () => number
}

const normalizeHeaders = (headers: Record<string, unknown> | undefined): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.toLowerCase()
    if ((!FORWARDABLE_SOURCE_HEADERS.has(name) && !name.startsWith('x-')) || typeof rawValue !== 'string' || rawValue.length > 8192 || /[\r\n]/.test(rawValue)) continue
    result[name] = rawValue
  }
  return result
}

export class TokenStore {
  private readonly entries = new Map<string, PlaybackToken>()
  private readonly now: () => number

  constructor(options: TokenStoreOptions = {}) {
    this.now = options.now ?? Date.now
  }

  create(input: { candidates: StreamCandidate[] } | { url: string, headers?: Record<string, unknown> }): string {
    this.pruneExpired()
    if (this.entries.size >= MAX_TOKENS) throw new Error('Playback token capacity reached')
    const rawCandidates = 'candidates' in input
      ? input.candidates
      : [{ sourceId: 'legacy', url: input.url, headers: input.headers as Record<string, string> | undefined }]
    if (rawCandidates.length === 0) throw new Error('Playback token requires at least one candidate')
    const candidates = rawCandidates.map(candidate => ({
      sourceId: candidate.sourceId,
      url: candidate.url,
      ...(candidate.headers == null ? {} : { headers: normalizeHeaders(candidate.headers) }),
    }))
    const primary = candidates[0]
    const token = randomBytes(32).toString('hex')
    this.entries.set(token, { url: primary.url, headers: primary.headers ?? {}, candidates, expiresAt: this.now() + TOKEN_TTL_MS })
    return token
  }

  get(token: string): PlaybackToken | undefined {
    const entry = this.entries.get(token)
    if (entry == null) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token)
      return undefined
    }
    return entry
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token)
    }
  }
}
