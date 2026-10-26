interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

interface DataEnvelope<T> {
  data: T
}

export class WebRuntimeError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'WebRuntimeError'
    this.code = code
    this.status = status
    this.details = details
  }
}

const isErrorEnvelope = (body: unknown): body is ErrorEnvelope => {
  if (body == null || typeof body !== 'object' || !('error' in body)) return false
  const error = body.error
  return error != null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && 'message' in error && typeof error.message === 'string'
}

export const webRuntimeResponseError = (response: Response, parsed: unknown): WebRuntimeError => {
  if (isErrorEnvelope(parsed)) {
    return new WebRuntimeError(parsed.error.code, response.status, parsed.error.message, parsed.error.details)
  }
  return new WebRuntimeError('HTTP_ERROR', response.status, response.statusText || `HTTP ${response.status}`)
}

const parseResponse = async(response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    if (!response.ok) throw new WebRuntimeError('HTTP_ERROR', response.status, text || response.statusText)
    throw new WebRuntimeError('INVALID_RESPONSE', response.status, 'Service returned invalid JSON')
  }
}

export type RuntimeRequest = <T>(method: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<T>

export const createRequest = (fetchImpl: typeof globalThis.fetch): RuntimeRequest => async<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
  let response: Response
  try {
    response = await fetchImpl(path, {
      method,
      ...(signal === undefined ? {} : { signal }),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new WebRuntimeError('NETWORK_ERROR', 0, 'Unable to reach TuneFlow Service', { cause })
  }
  const parsed = await parseResponse(response)
  if (!response.ok) throw webRuntimeResponseError(response, parsed)
  if (parsed != null && typeof parsed === 'object' && 'data' in parsed) return (parsed as DataEnvelope<T>).data
  return parsed as T
}

export const request: RuntimeRequest = createRequest(async(...args) => globalThis.fetch(...args))
