import { ApiError } from '../errors'

export const OFFICIAL_MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2/'

export const normalizeMusicBrainzBaseUrl = (value: unknown, options: { allowEmpty?: boolean } = {}): string => {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_SETTING', 'MusicBrainz address is invalid')
  const trimmed = value.trim()
  if (trimmed === '' && options.allowEmpty === true) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ApiError(400, 'INVALID_SETTING', 'MusicBrainz address is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new ApiError(400, 'INVALID_SETTING', 'MusicBrainz address is invalid')
  }
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/ws/2') ? `${path}/` : `${path}/ws/2/`.replace(/^\/\//, '/')
  return url.toString()
}
