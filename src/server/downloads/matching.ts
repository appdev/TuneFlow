const text = (value: unknown): string => typeof value === 'string' ? value : ''

const normalize = (value: unknown): string => text(value)
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\s·・,，、&＆/\\|()[\]{}【】（）._'"“”‘’:-]/g, '')

const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value != null
  ? value as Record<string, unknown>
  : {}

const identities = (value: unknown): Set<string> => {
  const info = record(value)
  const meta = record(info.meta)
  return new Set([info.id, info.songmid, meta.songId].filter((id): id is string | number =>
    (typeof id === 'string' && id.length > 0) || typeof id === 'number',
  ).map(String))
}

const seconds = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const parts = value.split(':').map(Number)
  if (parts.length !== 2 || parts.some(part => !Number.isFinite(part))) return undefined
  return parts[0] * 60 + parts[1]
}

export const isSameMusic = (left: unknown, right: unknown): boolean => {
  const leftInfo = record(left)
  const rightInfo = record(right)
  if (text(leftInfo.source) === text(rightInfo.source)) {
    const rightIds = identities(rightInfo)
    if ([...identities(leftInfo)].some(id => rightIds.has(id))) return true
  }

  const leftName = normalize(leftInfo.name)
  const rightName = normalize(rightInfo.name)
  const leftSinger = normalize(leftInfo.singer)
  const rightSinger = normalize(rightInfo.singer)
  if (!leftName || leftName !== rightName || !leftSinger || leftSinger !== rightSinger) return false

  const leftSeconds = seconds(leftInfo.interval)
  const rightSeconds = seconds(rightInfo.interval)
  return leftSeconds == null || rightSeconds == null || Math.abs(leftSeconds - rightSeconds) <= 3
}
