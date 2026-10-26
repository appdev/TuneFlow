export interface PlaylistSourceSnapshot {
  sourceKey: string
  musicKeys: string[]
}

interface Track { id: string, source: string }
const musicKey = (music: Track) => `${music.source}:${music.id}`

export const createSourceSnapshot = (sourceKey: string, songs: Track[]): PlaylistSourceSnapshot => ({
  sourceKey,
  musicKeys: [...new Set(songs.map(musicKey))],
})

// 平台曲目按最新顺序更新；只有上次平台快照内的曲目才允许因远端删除而移除。
// 旧版本没有快照时保守保留本地额外曲目，避免把手动添加误当成远端删除。
export const mergeSourcePlaylist = <T extends Track>(current: T[], remote: T[], sourceKey: string, snapshot?: PlaylistSourceSnapshot): T[] => {
  const previous = new Set(snapshot?.sourceKey == sourceKey ? snapshot.musicKeys : [])
  const seen = new Set<string>()
  const result: T[] = []
  for (const music of remote) {
    const key = musicKey(music)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(music)
  }
  for (const music of current) {
    const key = musicKey(music)
    if (seen.has(key) || previous.has(key)) continue
    seen.add(key)
    result.push(music)
  }
  return result
}
