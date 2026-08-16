export type SourceAction = 'musicUrl' | 'lyric' | 'pic'

export interface SourceCandidate { id: string, priority: number }
export interface SourceAttempt { sourceId: string, action: string, code: string, elapsedMs: number }
export interface SourceAttemptLog extends SourceAttempt { requestId: string, priority: number }
export interface SourceFallbackResult<T> { sourceId: string, value: T, attempts: SourceAttempt[] }

export interface SourceInfo {
  id: string
  name: string
  description: string
  version: string
  author: string
  homepage: string
}

export interface SourceSummary extends SourceInfo {
  active: boolean
  enabled: boolean
  priority: number | null
  sources?: Record<string, { type: 'music', actions: SourceAction[], qualitys: string[] }>
}

export interface InstalledSource extends SourceInfo {
  scriptPath: string
  installedAt: number
  sources?: SourceSummary['sources']
}

export interface SourceExportSource {
  id: string
  name: string
  version: string
  scriptPath: string
}

export interface SourceRequest {
  source: string
  action: SourceAction | string
  info?: unknown
}

export interface SearchRequest {
  source: string
  text: string
  page: number
  limit: number
}

export interface SearchResult {
  list: Array<Record<string, unknown>>
  total: number
  limit: number
  page: number
  source: string
}

export type CatalogSearchKind = 'track' | 'playlist' | 'album'

export interface CatalogCollection {
  id: string
  kind: Exclude<CatalogSearchKind, 'track'>
  name: string
  source: string
  author?: string
  total?: number
  img?: string | null
  description?: string
  [key: string]: unknown
}

export interface CollectionSearchResult {
  list: CatalogCollection[]
  total: number
  limit: number
  page: number
  source: string
}

export type SourceFailureOrigin = 'service-network' | 'worker-timeout' | 'caller' | 'script' | 'protocol' | 'safety'

export class SourceServiceError extends Error {
  constructor(readonly code: string, message = code, readonly origin: SourceFailureOrigin = 'protocol') {
    super(message)
  }
}
