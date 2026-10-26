/** Removes legacy local-file records before they cross a browser-facing boundary. */
export const projectBrowserDto = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(projectBrowserDto).filter(item => item !== undefined)
  if (value == null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.source === 'local') {
    if (typeof record.id !== 'string' || !/^[a-f0-9]{64}$/.test(record.id)) return undefined
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : 'Local track',
      singer: typeof record.singer === 'string' ? record.singer : '',
      source: 'local',
      interval: typeof record.interval === 'string' ? record.interval : '00:00',
      meta: {},
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, projectBrowserDto(child)]))
}
