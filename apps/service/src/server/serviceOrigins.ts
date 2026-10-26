import { ApiError } from './errors'

export const normalizeConfiguredServiceOrigin = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_SETTING', 'Service origin must be a string')
  }
  const trimmed = value.trim()
  if (trimmed === '') return ''

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ApiError(400, 'INVALID_SETTING', 'Service origin must be a valid URL')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new ApiError(400, 'INVALID_SETTING', 'Service origin must be a pathless HTTP(S) origin')
  }
  return parsed.origin
}
