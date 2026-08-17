export type DownloadStatus = 'waiting' | 'running' | 'paused' | 'error' | 'completed'
export type DownloadExtension = 'ape' | 'flac' | 'wav' | 'mp3'
export type DownloadFileNamePattern = '歌名 - 歌手' | '歌手 - 歌名' | '歌名'
export type ExistingFilePolicy = 'reuse' | 'error' | 'replace' | 'duplicate'

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
  existingFilePolicy?: ExistingFilePolicy
}

export interface DownloadReplacementState {
  originalRelativePath: string
  originalIntegrity: DownloadFileIntegrity
  previousDownloadIds: string[]
  phase: 'downloading' | 'prepared' | 'published' | 'retired'
  replacementIntegrity?: DownloadFileIntegrity
  stagedMediaRelativePath?: string
  stagedLyricRelativePath?: string
  finalLyricRelativePath?: string
  lyricIntegrity?: DownloadFileIntegrity
}

export interface DownloadMetadataPatchState {
  stagedRelativePath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
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
    stagedMediaRelativePath?: string
    stagedLyricRelativePath?: string
    finalLyricRelativePath?: string
    lyricIntegrity?: DownloadFileIntegrity
  }
  finalIntegrity?: DownloadFileIntegrity
  metadataPatch?: DownloadMetadataPatchState
  replacement?: DownloadReplacementState
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
  candidates?: ResolvedDownloadCandidate[]
  resources?: {
    pictureBytes?: Uint8Array
    pictureMimeType?: string
    lyrics?: TuneFlow.Music.LyricInfo
  }
}

export interface ResolvedDownloadCandidate {
  sourceId: string
  url: string
  headers?: Record<string, string>
  resources?: ResolvedDownload['resources']
  completeness?: 'complete' | 'mixed' | 'audio-only'
  sourceIds?: { audio: string, lyrics?: string, picture?: string }
}
