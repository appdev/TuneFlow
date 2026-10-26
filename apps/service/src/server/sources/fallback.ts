import { randomUUID } from 'node:crypto'
import { ApiError } from '../errors'
import { SourceServiceError, type SourceAttempt, type SourceCandidate, type SourceAttemptLog, type SourceFallbackResult } from './types'

const isRetryable = (error: SourceServiceError): boolean => {
  return error.origin === 'service-network' || error.origin === 'worker-timeout'
}

export const runSourceFallback = async<T>(_input: {
  candidates: readonly SourceCandidate[]
  action: string
  requestId?: string
  signal?: AbortSignal
  now?: () => number
  onAttempt?: (attempt: SourceAttemptLog) => void
  attempt: (candidate: SourceCandidate, signal?: AbortSignal) => Promise<T>
}): Promise<SourceFallbackResult<T>> => {
  const now = _input.now ?? Date.now
  const requestId = _input.requestId ?? randomUUID()
  const attempts: SourceAttempt[] = []
  for (const candidate of [..._input.candidates].sort((a, b) => a.priority - b.priority)) {
    if (_input.signal?.aborted === true) throw new SourceServiceError('SOURCE_CANCELLED', 'Source request cancelled', 'caller')
    const startedAt = now()
    try {
      const value = await _input.attempt(candidate, _input.signal)
      _input.onAttempt?.({ requestId, sourceId: candidate.id, priority: candidate.priority, action: _input.action, code: 'OK', elapsedMs: Math.max(0, now() - startedAt) })
      return { sourceId: candidate.id, value, attempts }
    } catch (error) {
      if (!(error instanceof SourceServiceError)) throw error
      const attempt = { sourceId: candidate.id, action: _input.action, code: error.code, elapsedMs: Math.max(0, now() - startedAt) }
      attempts.push(attempt)
      _input.onAttempt?.({ requestId, priority: candidate.priority, ...attempt })
      if (!isRetryable(error)) throw error
    }
  }
  throw new ApiError(502, 'SOURCE_ALL_UNAVAILABLE', 'All enabled sources are unavailable', { attempts })
}
