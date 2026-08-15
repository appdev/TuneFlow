export type DownloadStatus = 'waiting' | 'running' | 'paused' | 'error' | 'completed'
export type DownloadExtension = 'ape' | 'flac' | 'wav' | 'mp3'
export type DownloadFileNamePattern = '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

export interface DownloadFileIntegrity {
  size: number
  sha256: string
}

export interface DownloadCreateInput {
  musicInfo: TuneFlow.Music.MusicInfoOnline
  quality: TuneFlow.Quality
  qualityList?: TuneFlow.QualityList
  listId?: string
  skipExisting?: boolean
  qualityPolicy?: 'selected' | 'highest'
}

export interface DownloadJobRecord {
  id: string
  status: DownloadStatus
  musicInfo: TuneFlow.Music.MusicInfoOnline
  quality: TuneFlow.Quality
  qualityCandidates?: TuneFlow.Quality[]
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
  finalIntegrity?: DownloadFileIntegrity
  useDefaultDownloadSettings?: boolean
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
  musicInfo: TuneFlow.Music.MusicInfoOnline
  quality: TuneFlow.Quality
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
  url?: string
  headers?: Record<string, string>
  candidates?: Array<{ sourceId: string, url: string, headers?: Record<string, string> }>
  resources?: {
    pictureBytes?: Uint8Array
    pictureMimeType?: string
    lyrics?: TuneFlow.Music.LyricInfo
  }
}
