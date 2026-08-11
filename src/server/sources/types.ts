export type SourceAction = 'musicUrl' | 'lyric' | 'pic'

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
  sources?: Record<string, { type: 'music', actions: SourceAction[], qualitys: string[] }>
}

export interface InstalledSource extends SourceInfo {
  scriptPath: string
  installedAt: number
  sources?: SourceSummary['sources']
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

export class SourceServiceError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
  }
}
