import { afterEach, expect, it, vi } from 'vitest'
import { pollAccountLogin } from '../../../../../packages/service-client/src/accountLogin'
import { ServiceError } from '../../../../../packages/service-client/src/client'

afterEach(() => { vi.useRealTimers() })

it.each([new ServiceError('NETWORK_ERROR'), new ServiceError('TIMEOUT'), new ServiceError('ACCOUNT_PROVIDER_ERROR', 502)])('recovers from a transient failure after scanning: %s', async failure => {
  vi.useFakeTimers()
  const poll = vi.fn().mockResolvedValueOnce({ status: 'scanned' }).mockRejectedValueOnce(failure).mockResolvedValueOnce({ status: 'connected' })
  const status = vi.fn(); const error = vi.fn()
  pollAccountLogin({ expiresAt: Date.now() + 30000, active: () => true, poll, status, error })
  await vi.advanceTimersByTimeAsync(7500)
  expect(status.mock.calls).toEqual([['scanned'], ['connected']])
  expect(error).toHaveBeenCalledWith(failure, true)
  await vi.advanceTimersByTimeAsync(5000)
  expect(poll).toHaveBeenCalledTimes(3)
})

it.each(['DEVICE_AUTH_REQUIRED', 'ACCOUNT_CHANGED', 'PLATFORM_LOGIN_REQUIRED', 'ACCOUNT_LOGIN_EXPIRED', 'ACCOUNT_VERIFICATION_REQUIRED'])('stops on a terminal error: %s', async code => {
  vi.useFakeTimers()
  const failure = new ServiceError(code, code === 'ACCOUNT_VERIFICATION_REQUIRED' ? 409 : 401)
  const poll = vi.fn().mockRejectedValue(failure); const error = vi.fn()
  pollAccountLogin({ expiresAt: Date.now() + 30000, active: () => true, poll, status: vi.fn(), error })
  await vi.advanceTimersByTimeAsync(10000)
  expect(poll).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalledWith(failure, false)
})

it('ends transient retries at QR expiry', async() => {
  vi.useFakeTimers()
  const poll = vi.fn().mockRejectedValue(new ServiceError('NETWORK_ERROR')); const status = vi.fn()
  pollAccountLogin({ expiresAt: Date.now() + 5000, active: () => true, poll, status, error: vi.fn() })
  await vi.advanceTimersByTimeAsync(15000)
  expect(poll).toHaveBeenCalledTimes(1)
  expect(status).toHaveBeenCalledExactlyOnceWith('expired')
})

it('ignores an in-flight success after cancellation', async() => {
  vi.useFakeTimers()
  let resolve!: (value: { status: 'connected' }) => void
  const poll = vi.fn(() => new Promise<{ status: 'connected' }>(done => { resolve = done })); const status = vi.fn()
  const stop = pollAccountLogin({ expiresAt: Date.now() + 30000, active: () => true, poll, status, error: vi.fn() })
  await vi.advanceTimersByTimeAsync(2500)
  stop(); resolve({ status: 'connected' })
  await vi.advanceTimersByTimeAsync(10000)
  expect(status).not.toHaveBeenCalled()
  expect(poll).toHaveBeenCalledTimes(1)
})
