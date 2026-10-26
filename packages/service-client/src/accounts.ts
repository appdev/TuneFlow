import { accountAccess, ServiceError, type ServiceClient, type TrackDto } from './client'
import type { QQFavoriteResult } from '../../platform-accounts/src/qqFavorite'
export type AccountProvider = 'tx' | 'wy' | 'kg'
export interface AccountProfile { importOwner?: string, state: 'connected' | 'expired' | 'disconnected' | 'unavailable', displayName: string, avatar: string, accountHint: string, hasSession: boolean }
export interface AccountStatus { tx: boolean, wy: boolean, kg: boolean, serverId: string, revision: number, revisions: Record<AccountProvider, number>, accounts: Record<AccountProvider, AccountProfile> }
export interface AccountPlaylist { id: string, name: string, cover: string, trackCount: number, creator: string, importOwner?: string, accountId?: string, kind?: 'created' | 'favorite' }
export interface AuthorizedDevice { id: string, name: string, createdAt: number }
export interface AccountLogin { id: string, provider: AccountProvider, image: string, expiresAt: number }
export const sharedAccounts = (client: ServiceClient) => ({
  status: async(refresh = false) => client.request<AccountStatus>(`/api/v1/accounts/status${refresh ? '?refresh=true' : ''}`),
  accessStatus: async() => client.request<{ passwordConfigured: boolean }>('/api/v1/access/status'),
  device: async() => client.request<{ serverId: string, device: AuthorizedDevice, passwordConfigured: boolean }>('/api/v1/access/device'),
  signIn: async(password: string, name: string) => {
    const result = await client.request<{ token: string, serverId: string, device: AuthorizedDevice }>('/api/v1/access/login', 'POST', { password, name })
    await accountAccess.set(client.endpoint, result.token)
    return { serverId: result.serverId, device: result.device }
  },
  setPassword: async(password: string, currentPassword?: string) => client.request('/api/v1/access/password', 'PUT', { password, ...(currentPassword === undefined ? {} : { currentPassword }) }),
  signOut: async() => {
    const token = await accountAccess.get(client.endpoint)
    await client.request('/api/v1/access/session', 'DELETE')
    if (await accountAccess.get(client.endpoint) === token) await accountAccess.remove(client.endpoint)
  },
  disconnect: async() => accountAccess.remove(client.endpoint),
  login: async(provider: AccountProvider) => client.request<AccountLogin>(`/api/v1/accounts/${provider}/login`, 'POST'),
  poll: async(id: string) => client.request<{ status: 'waiting' | 'scanned' | 'expired' | 'connected' }>(`/api/v1/accounts/login/${encodeURIComponent(id)}/poll`, 'POST'),
  cancel: async(id: string) => client.request(`/api/v1/accounts/login/${encodeURIComponent(id)}`, 'DELETE'),
  logout: async(provider: AccountProvider, revision: number) => client.request(`/api/v1/accounts/${provider}/logout`, 'POST', { revision }),
  upload: async(provider: AccountProvider, revision: number, credential: { cookies: Record<string, string>, kugou?: unknown, dailyKey?: string }) => client.request(`/api/v1/accounts/${provider}/session`, 'POST', { revision, credential }),
  playlists: async(provider: AccountProvider) => client.request<{ provider: AccountProvider, status: string, playlists: AccountPlaylist[], revision: number }>(`/api/v1/accounts/${provider}/playlists`),
  tracks: async(provider: AccountProvider, id: string, revision: number) => client.request<{ list: TrackDto[], importOwner: string, revision: number }>(`/api/v1/accounts/${provider}/playlist`, 'POST', { id, revision }),
  import: async(provider: AccountProvider, id: string, revision: number) => client.request<{ id: string, count: number }>(`/api/v1/accounts/${provider}/import`, 'POST', { id, revision }),
  favorite: async(songMid: string, action: 'add' | 'check', revision: number) => client.request<QQFavoriteResult>('/api/v1/accounts/tx/favorite', 'POST', { songMid, action, revision }),
  authorizeDaily: async(key: string, revision: number) => client.request<{ configured: boolean, revision: number }>('/api/v1/accounts/tx/daily-key', 'POST', { key, revision }),
  daily: async(provider: AccountProvider, refresh = false) => client.request<{ list: TrackDto[], status: 'personalized' | 'login_required' | 'unavailable', kind?: 'radar' | 'official_daily' | 'netease_daily' | 'kugou_daily', importOwner?: string, revision: number }>(`/api/v1/accounts/${provider}/daily${refresh ? '?refresh=true' : ''}`),
})

export const probeAccountAccess = async(client: ServiceClient): Promise<{ state: 'authorized' | 'locked' | 'unavailable', serverId?: string, deviceId?: string }> => {
  const token = await accountAccess.get(client.endpoint)
  if (!token) return { state: 'locked' }
  try {
    const result = await sharedAccounts(client).device()
    return { state: 'authorized', serverId: result.serverId, deviceId: result.device.id }
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'DEVICE_AUTH_REQUIRED') {
      if (await accountAccess.get(client.endpoint) === token) await accountAccess.remove(client.endpoint)
      return { state: 'locked' }
    }
    return { state: 'unavailable' }
  }
}
