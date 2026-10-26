import { ServiceError, type ServiceClient, type TrackDto } from './client'

// Mirror Service download identity matching, including cross-platform copies.
const normalize = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase().replace(/[\s·・,，、&＆/\\|()[\]{}【】（）._'"“”‘’:-]/g, '') : ''
const sameTrack = (left: TrackDto, right: TrackDto) => {
  const ids = (track: TrackDto) => [track.id, track.songmid, track.meta?.songId].filter(id => id !== undefined && id !== null && id !== '').map(String)
  if (left.source === right.source && ids(left).some(id => ids(right).includes(id))) return true
  const name = normalize(left.name)
  const singer = normalize(left.singer)
  if (!name || name !== normalize(right.name) || !singer || singer !== normalize(right.singer)) return false
  const seconds = (interval: TrackDto['interval']) => {
    const parts = interval?.split(':').map(Number)
    return parts?.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : undefined
  }
  const a = seconds(left.interval)
  const b = seconds(right.interval)
  return a === undefined || b === undefined || Math.abs(a - b) <= 3
}

// Automatic playback saves use the Service's reuse policy. Manual downloads
// require an explicit decision before replacing an existing audio file.
export const downloadWithConfirmation = async(
  client: ServiceClient, track: TrackDto, quality: string,
  confirmReplace: () => Promise<boolean>, isCurrent = () => true,
): Promise<boolean> => {
  if (!isCurrent()) throw new ServiceError('SERVER_CHANGED')
  try {
    await client.download(track, quality, 'error')
    return true
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== 'DOWNLOAD_ALREADY_EXISTS') throw error
  }
  const active = (await client.downloads()).some(task => task.status !== 'completed' && task.status !== 'error' && sameTrack(task.musicInfo, track))
  if (active) throw new ServiceError('DOWNLOAD_TASK_ACTIVE')
  if (!await confirmReplace()) return false
  if (!isCurrent()) throw new ServiceError('SERVER_CHANGED')
  await client.download(track, quality, 'replace')
  return true
}

export const replacementMessage = (name: string | undefined, quality: string) => `“${name ?? '这首歌曲'}”已有音频。是否按 ${quality} 重新下载并替换？新文件下载并处理成功后才会替换旧文件；失败时保留原文件。`
