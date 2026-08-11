export type DownloadStatus = 'waiting' | 'running' | 'paused' | 'error' | 'completed'
export type DownloadExtension = 'ape' | 'flac' | 'wav' | 'mp3'
export type DownloadFileNamePattern = '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

export interface DownloadCreateInput {
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  qualityList?: LX.QualityList
  listId?: string
}

export interface DownloadJobRecord {
  id: string
  status: DownloadStatus
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  extension: DownloadExtension
  fileName: string
  finalRelativePath: string
  partRelativePath: string
  downloaded: number
  total: number
  etag?: string
  lastModified?: string
  publication?: {
    phase: 'prepared' | 'published'
    sha256: string
    size: number
  }
  partCleanupPending?: boolean
  finalMissing?: boolean
  warning?: string
  error?: string
  listId?: string
  createdAt: number
  updatedAt: number
}

export interface DownloadDto {
  id: string
  status: DownloadStatus
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  extension: DownloadExtension
  fileName: string
  downloaded: number
  total: number
  progress: number
  queuePosition: number | null
  createdAt: number
  updatedAt: number
  warning?: string
  error?: string
  listId?: string
}

export interface ResolvedDownload {
  url: string
  headers?: Record<string, string>
}
