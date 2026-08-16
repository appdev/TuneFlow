export const MAX_RESOURCE_ALTERNATIVES = 6

export type ResourceAlternative = Record<string, unknown> & { source: string }

export const providerTrackIdentity = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value == null) return undefined
  const candidate = value as Record<string, unknown>
  const meta = typeof candidate.meta === 'object' && candidate.meta != null
    ? candidate.meta as Record<string, unknown>
    : {}
  const identity = [meta.songId, candidate.songmid, candidate.id].find(field =>
    (typeof field === 'string' && field.trim() !== '') || typeof field === 'number')
  return identity == null ? undefined : String(identity)
}

export const boundedResourceAlternatives = (
  originalProvider: string,
  candidates: Array<Record<string, unknown>>,
): ResourceAlternative[] => {
  const seen = new Set<string>()
  const result: ResourceAlternative[] = []
  for (const candidate of candidates) {
    if (typeof candidate.source !== 'string') continue
    const provider = candidate.source.trim()
    if (provider === '' || provider === originalProvider.trim()) continue
    const trackId = providerTrackIdentity(candidate)
    if (trackId == null) continue
    const key = `${provider}\0${trackId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...candidate, source: provider })
    if (result.length === MAX_RESOURCE_ALTERNATIVES) break
  }
  return result
}
