interface Track {
  id: string
  source: string
  name: string
  singer: string
  interval?: string | null
  meta: { songId?: string | number }
}
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
const artists = (value: string) => value.split(/[、,，;；/&]/).map(normalize).filter(Boolean).sort().join('|')
const duration = (value?: string | null) => value && /^\d+(?::\d+){1,2}$/.test(value) ? value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) : 0

export const isSamePlatformTrack = (a: Track, b: Track) => a.source == b.source && (a.id == b.id || (a.meta.songId != null && b.meta.songId != null && String(a.meta.songId) != '' && String(a.meta.songId) == String(b.meta.songId)))

// 不剥离 Live、Remix 等版本信息；缺少歌手或时长时不猜测匹配。
export const isSameLocalRecording = (online: Track, local: Track) => {
  const left = duration(online.interval)
  const right = duration(local.interval)
  return !!online.name.trim() && !!online.singer.trim() && normalize(online.name) == normalize(local.name) && artists(online.singer) == artists(local.singer) && left > 0 && right > 0 && Math.abs(left - right) <= 2
}
