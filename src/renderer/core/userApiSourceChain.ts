export const splitSourceChain = (list: readonly TuneFlow.UserApi.UserApiInfo[]) => {
  const enabled = list
    .filter(source => source.enabled === true && Number.isInteger(source.priority) && source.priority! >= 0)
    .slice()
    .sort((a, b) => a.priority! - b.priority!)
  const enabledIds = new Set(enabled.map(source => source.id))
  const disabled = list.filter(source => !enabledIds.has(source.id))
  return { enabled, disabled }
}

export const toggleSource = (enabledIds: readonly string[], sourceId: string, enabled: boolean): string[] => {
  if (enabled) return enabledIds.includes(sourceId) ? [...enabledIds] : [...enabledIds, sourceId]
  return enabledIds.filter(id => id !== sourceId)
}

export const moveSource = (enabledIds: readonly string[], oldIndex: number, newIndex: number): string[] => {
  const next = [...enabledIds]
  if (!Number.isInteger(oldIndex) || !Number.isInteger(newIndex) || oldIndex < 0 || newIndex < 0 || oldIndex >= next.length || newIndex >= next.length || oldIndex === newIndex) return next
  const [sourceId] = next.splice(oldIndex, 1)
  next.splice(newIndex, 0, sourceId)
  return next
}

export const nextLegacySource = (enabledIds: readonly string[], builtInIds: readonly string[]): string => enabledIds[0] ?? builtInIds[0] ?? ''
