/** Connection readiness is independent of shared-account authorization. */
export interface ConnectionState {
  connected: boolean
  busy: boolean
  error: string
  endpoint: string
  configured: boolean
  hasConnected: boolean
}

export const connectionKey = (endpoint: string) => `tuneflow.connection.v1.${encodeURIComponent(endpoint)}`
export const createConnectionState = (endpoint: string, configured: boolean, hasConnected = configured): ConnectionState => ({
  endpoint, configured, hasConnected, connected: false, busy: false, error: '',
})
export const requiresService = (section: string) => ['accounts', 'sources', 'downloads'].includes(section)
