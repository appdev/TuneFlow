import { arrPushByPosition, arrShuffle, similar, sortInsert } from './common'

const intervalSeconds = (musicInfo: TuneFlow.Music.MusicInfo): number => {
  if (!musicInfo.interval) return 0
  const parts = musicInfo.interval.split(':')
  let seconds = 0
  let unit = 1
  while (parts.length) {
    seconds += Number.parseInt(parts.pop()!) * unit
    unit *= 60
  }
  return seconds
}

export type SortFieldName = 'name' | 'singer' | 'albumName' | 'interval' | 'source'
export type SortFieldType = 'up' | 'down' | 'random'

export const sortListMusicInfo = async(
  list: TuneFlow.Music.MusicInfo[],
  sortType: SortFieldType,
  fieldName: SortFieldName,
  localeId: string,
): Promise<TuneFlow.Music.MusicInfo[]> => {
  if (sortType === 'random') {
    arrShuffle(list)
    return list
  }
  const direction = sortType === 'up' ? 1 : -1
  list.sort((left, right) => {
    const leftValue = fieldName === 'albumName' ? left.meta.albumName : left[fieldName]
    const rightValue = fieldName === 'albumName' ? right.meta.albumName : right[fieldName]
    if (leftValue == null) return rightValue == null ? 0 : -direction
    if (rightValue == null) return direction
    if (fieldName === 'interval') return (intervalSeconds(left) - intervalSeconds(right)) * direction
    return String(leftValue).localeCompare(String(rightValue), localeId) * direction
  })
  return list
}

const variantPattern = /(\(|（).+(\)|）)/g
const punctuationPattern = /\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[/g

export const filterDuplicateMusic = async(
  list: TuneFlow.Music.MusicInfo[],
  filterVariants = true,
): Promise<Array<{ id: string, index: number, musicInfo: TuneFlow.Music.MusicInfo }>> => {
  interface Entry { id: string, index: number, musicInfo: TuneFlow.Music.MusicInfo }
  const groups = new Map<string, Entry[]>()
  const duplicates = new Set<string>()
  for (const [index, musicInfo] of list.entries()) {
    let name = filterVariants
      ? musicInfo.name.toLowerCase().replace(variantPattern, '').replace(punctuationPattern, '')
      : musicInfo.name.toLowerCase().trim()
    if (filterVariants && name.length === 0) name = musicInfo.name.toLowerCase().replace(/\s+/g, '')
    const entries = groups.get(name)
    if (entries == null) groups.set(name, [{ id: musicInfo.id, index, musicInfo }])
    else {
      entries.push({ id: musicInfo.id, index, musicInfo })
      duplicates.add(name)
    }
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right)).flatMap(name => groups.get(name)!)
}

export const searchListMusic = (list: TuneFlow.Music.MusicInfo[], text: string): TuneFlow.Music.MusicInfo[] => {
  const nameMatches = new Set<TuneFlow.Music.MusicInfo>()
  const singerMatches = new Set<TuneFlow.Music.MusicInfo>()
  const albumMatches = new Set<TuneFlow.Music.MusicInfo>()
  const textLower = text.toLowerCase()
  for (const musicInfo of list) {
    if (musicInfo.name?.toLowerCase().includes(textLower)) nameMatches.add(musicInfo)
    else if (musicInfo.singer?.toLowerCase().includes(textLower)) singerMatches.add(musicInfo)
    else if (musicInfo.meta.albumName?.toLowerCase().includes(textLower)) albumMatches.add(musicInfo)
  }

  const fuzzyPattern = new RegExp(text.split('').map(value => value.replace(/[.*+?^${}()|[\]\\]/, '\\$&')).join('.*') + '.*', 'i')
  const fuzzyMatches: Array<{ num: number, data: TuneFlow.Music.MusicInfo }> = []
  for (const musicInfo of list) {
    if (nameMatches.has(musicInfo) || singerMatches.has(musicInfo) || albumMatches.has(musicInfo)) continue
    const candidate = `${musicInfo.name}${musicInfo.singer}${musicInfo.meta.albumName ?? ''}`
    if (!fuzzyPattern.test(candidate)) continue
    sortInsert(fuzzyMatches, { num: similar(text, candidate), data: musicInfo })
  }
  return [
    ...nameMatches,
    ...singerMatches,
    ...albumMatches,
    ...fuzzyMatches.map(item => item.data).reverse(),
  ]
}

export const createSortedList = (
  list: TuneFlow.Music.MusicInfo[],
  position: number,
  ids: string[],
): TuneFlow.Music.MusicInfo[] => {
  const byId = new Map(list.map(item => [item.id, item]))
  const selected = ids.flatMap(id => {
    const item = byId.get(id)
    if (item == null) return []
    byId.delete(id)
    return [item]
  })
  const remaining = list.filter(item => byId.has(item.id))
  arrPushByPosition(remaining, selected, Math.min(position, remaining.length))
  return remaining
}
