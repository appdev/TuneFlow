import { ServiceClient, ServiceError, type LyricsDto, type TrackDto } from './client'

export interface ServiceProvenance { endpoint: string, track: TrackDto, streamPath?: string, picturePath?: string, lyricsPath?: string, recommendationItemId?: string, playQuality?: LX.Quality }
export type ServiceTrack = LX.Music.MusicInfoOnline & { meta: LX.Music.MusicInfoOnline['meta'] & { service: ServiceProvenance } }
const qualities: LX.Quality[] = ['128k', '320k', 'flac', 'flac24bit']
const resolvedResources = new WeakMap<ServiceProvenance, string>()
export const isResolvedServiceResource = (service: ServiceProvenance, url: string) => resolvedResources.get(service) === url

export const toServiceTrack = (track: TrackDto, endpoint: string, extra: Partial<ServiceProvenance> = {}): ServiceTrack => {
  // Vue rows may contain nested proxies. Electron IPC/worker queues require a
  // complete plain-data snapshot, including the original DTO in provenance.
  track = JSON.parse(JSON.stringify(track)) as TrackDto
  const client = new ServiceClient(endpoint)
  if (!track.id || !['kw', 'kg', 'tx', 'wy', 'mg', 'local'].includes(track.source ?? '')) throw new ServiceError('INVALID_TRACK')
  const meta = track.meta ?? {}
  const service: ServiceProvenance = { ...extra, endpoint: client.endpoint, track }
  if (service.streamPath) client.resourceUrl(service.streamPath)
  const available = Array.isArray(meta.qualitys) ? meta.qualitys.filter((item: { type: unknown }) => qualities.includes(item.type as LX.Quality)) : []
  const result: Record<string, unknown> = {
    id: `service:${client.endpoint}:${track.source}:${track.id}`,
    name: track.name ?? '未知歌曲',
    singer: track.singer ?? '',
    source: track.source === 'local' ? 'kw' : track.source,
    interval: track.interval ?? null,
    meta: {
      ...meta,
      songId: meta.songId ?? track.songmid ?? track.id,
      albumName: meta.albumName ?? track.albumName ?? '',
      picUrl: service.picturePath ? client.resourceUrl(service.picturePath) : null,
      qualitys: available.length ? available : [{ type: '128k', size: null }],
      _qualitys: Object.fromEntries((available.length ? available : [{ type: '128k', size: null }]).map(item => [item.type, { size: item.size ?? null }])),
      toggleMusicInfo: undefined,
      service,
    },
  }
  return result as unknown as ServiceTrack
}

export const getServiceProvenance = (track: LX.Music.MusicInfo | LX.Download.ListItem | null | undefined): ServiceProvenance | undefined => {
  if (!track || 'progress' in track) return undefined
  return (track.meta as ServiceTrack['meta']).service
}
export const isServerLibraryTrack = (track: LX.Music.MusicInfo) => getServiceProvenance(track)?.track.source === 'local'

export const resolveServiceTrack = async(service: ServiceProvenance, requestedQuality?: LX.Quality, signal?: AbortSignal) => {
  const quality = requestedQuality ?? service.playQuality ?? '128k'
  const client = new ServiceClient(service.endpoint)
  if (service.streamPath) {
    const url = client.resourceUrl(service.streamPath)
    resolvedResources.set(service, url)
    return { url, quality }
  }
  const result = await client.resolve(service.track, quality, service.recommendationItemId, signal)
  const url = client.resourceUrl(result.url)
  resolvedResources.set(service, url)
  return { url, quality: qualities.includes(result.quality as LX.Quality) ? result.quality as LX.Quality : quality }
}

export const serviceLyrics = (lyrics: LyricsDto): LX.Player.LyricInfo => ({
  lyric: lyrics.lyric,
  tlyric: lyrics.tlyric ?? '',
  rlyric: lyrics.rlyric ?? '',
  lxlyric: lyrics.verbatimLyric ?? '',
  rawlrcInfo: { lyric: lyrics.lyric, tlyric: lyrics.tlyric ?? '', rlyric: lyrics.rlyric ?? '', lxlyric: lyrics.verbatimLyric ?? '' },
})
