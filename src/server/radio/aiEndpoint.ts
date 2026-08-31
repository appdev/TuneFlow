import { ApiError } from '../errors'

export const normalizeAIBaseUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') return ''
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ApiError(400, 'INVALID_AI_BASE_URL', 'AI base URL is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new ApiError(400, 'INVALID_AI_BASE_URL', 'AI base URL is invalid')
  }
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.toString()
}

export const aiResponsesUrl = (baseUrl: string): URL => new URL('responses', normalizeAIBaseUrl(baseUrl))

export const isSameAIOrigin = (left: URL, right: URL): boolean => left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port
