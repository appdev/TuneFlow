export interface ChainSource { id: string, enabled: boolean, priority: number | null }

export const splitSourceChain = <T extends ChainSource>(sources: readonly T[]) => ({
  enabled: sources.filter(source => source.enabled).sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)),
  disabled: sources.filter(source => !source.enabled),
})

export const enabledSourceIds = (sources: readonly ChainSource[]) => splitSourceChain(sources).enabled.map(source => source.id)

export const toggleSource = (sources: readonly ChainSource[], id: string, enabled: boolean) => {
  const ids = enabledSourceIds(sources)
  if (!sources.some(source => source.id === id)) return ids
  return enabled ? ids.includes(id) ? ids : [...ids, id] : ids.filter(value => value !== id)
}

export const moveSource = (sources: readonly ChainSource[], id: string, position: number) => {
  const ids = enabledSourceIds(sources)
  const from = ids.indexOf(id)
  if (from < 0 || !Number.isInteger(position) || position < 0 || position >= ids.length) return ids
  ids.splice(from, 1)
  ids.splice(position, 0, id)
  return ids
}
