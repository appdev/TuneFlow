export interface QQPlaylistPage {
  ids: string[]
  total?: number
  hasMore?: boolean
}

// 分页不完整或平台重复返回同一页时拒绝保存，避免把本地歌单截短。
export const collectQQPlaylistIds = async(readPage: (offset: number) => Promise<QQPlaylistPage>) => {
  const seen = new Set<string>()
  let offset = 0
  let expectedTotal: number | undefined
  for (let page = 0; page < 1000; page++) {
    const result = await readPage(offset)
    if (page == 0 && !result.ids.length && result.total == null && result.hasMore !== false) throw new Error('playlist_incomplete')
    if (result.total != null) {
      if (!Number.isSafeInteger(result.total) || result.total < 0 || (expectedTotal != null && expectedTotal != result.total)) throw new Error('playlist_incomplete')
      expectedTotal = result.total
    }
    if (result.ids.some(id => !/^[a-zA-Z0-9]+$/.test(id))) throw new Error('playlist_incomplete')
    const previousSize = seen.size
    for (const id of result.ids) seen.add(id)
    if (seen.size - previousSize != result.ids.length) throw new Error('playlist_incomplete')
    offset += result.ids.length
    if (expectedTotal != null && offset > expectedTotal) throw new Error('playlist_incomplete')
    const complete = expectedTotal != null && offset == expectedTotal
    if (result.hasMore === false || !result.ids.length || complete) {
      if ((expectedTotal != null && !complete) || result.hasMore === true) throw new Error('playlist_incomplete')
      return [...seen]
    }
    if (seen.size == previousSize) throw new Error('playlist_incomplete')
  }
  throw new Error('playlist_incomplete')
}

// 复用本地元数据，只获取新增歌曲；全部解析成功后才交给调用者保存。
export const resolveQQPlaylistTracks = async<T>(
  ids: string[],
  cached: Map<string, T>,
  load: (id: string) => Promise<T>,
  progress?: (current: number, total: number) => void,
  shouldCancel: () => boolean = () => false,
) => {
  const orderedIds = [...new Set(ids)]
  const songs: T[] = []
  for (let offset = 0; offset < orderedIds.length; offset += 16) {
    if (shouldCancel()) throw new Error('cancelled')
    const chunk = orderedIds.slice(offset, offset + 16)
    const results = await Promise.all(chunk.map(async id => cached.get(id) ?? await load(id)))
    if (results.some(song => song == null)) throw new Error('playlist_incomplete')
    songs.push(...results)
    progress?.(songs.length, orderedIds.length)
  }
  if (shouldCancel()) throw new Error('cancelled')
  return songs
}
