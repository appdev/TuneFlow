import { ServiceError } from './client'

type LoginStatus = 'waiting' | 'scanned' | 'expired' | 'connected'

// Keep transient provider/transport failures within the same QR attempt.
export const pollAccountLogin = (options: {
  expiresAt: number
  active: () => boolean
  poll: () => Promise<{ status: LoginStatus }>
  status: (status: LoginStatus) => void
  error: (error: unknown, retrying: boolean) => void
}) => {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const active = () => !stopped && options.active()
  const schedule = () => { timer = setTimeout(() => { void poll() }, 2500) }
  const poll = async() => {
    if (!active()) return
    if (Date.now() >= options.expiresAt) { options.status('expired'); return }
    try {
      const result = await options.poll()
      if (!active()) return
      options.status(result.status)
      if (result.status === 'connected' || result.status === 'expired') return
    } catch (error) {
      if (!active()) return
      const retrying = error instanceof ServiceError && (
        ['NETWORK_ERROR', 'TIMEOUT', 'ACCOUNT_RATE_LIMIT'].includes(error.code) || error.status >= 500
      )
      options.error(error, retrying)
      if (!retrying) return
    }
    if (active()) schedule()
  }
  schedule()
  return () => { stopped = true; clearTimeout(timer) }
}
