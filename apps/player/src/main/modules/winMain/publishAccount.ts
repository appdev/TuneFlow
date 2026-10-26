import { readyAccountSession } from './accountSession'
import { readAccountCredential } from './accountStorage'
import { readKugouSession } from './kugouAccount'
import { type MusicAccountProvider, getMusicAccountStatus } from './musicAccount'
import { normalizeEndpoint, ServiceError } from '../../../../../../packages/service-client/src/client'

export const publishAccountToService = async(input: { provider: MusicAccountProvider, endpoint: string, token: string, revision: number }) => {
  if (!['tx', 'wy', 'kg'].includes(input.provider) || !/^[\w-]{43}$/.test(input.token) || !Number.isInteger(input.revision) || input.revision < 0) throw new ServiceError('INVALID_ACCOUNT_REQUEST')
  const endpoint = normalizeEndpoint(input.endpoint)
  const before = await getMusicAccountStatus()
  if (!before[input.provider]) throw new ServiceError('PLATFORM_LOGIN_REQUIRED')
  const owner = before.accounts[input.provider].importOwner
  const names = input.provider === 'tx' ? ['qqmusic_key', 'qm_keyst', 'musickey', 'qqmusic_uin', 'musicid', 'login_type', 'wxuin', 'uin'] : ['MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID']
  const cookies = input.provider === 'kg' ? {} : Object.fromEntries((await (await readyAccountSession(input.provider)).cookies.get({ url: input.provider === 'tx' ? 'https://y.qq.com/' : 'https://music.163.com/' })).filter(cookie => names.includes(cookie.name)).map(cookie => [cookie.name, cookie.value]))
  const credential = { cookies, ...(input.provider === 'kg' ? { kugou: readKugouSession() } : {}), ...(input.provider === 'tx' ? { dailyKey: readAccountCredential('qqDailyApiKey') } : {}) }
  const after = await getMusicAccountStatus()
  if (!owner || owner !== after.accounts[input.provider].importOwner) throw new ServiceError('ACCOUNT_CHANGED')
  // Send in the main process; raw platform credentials never cross renderer IPC.
  const response = await fetch(`${endpoint}/api/v1/accounts/${input.provider}/session`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: input.revision, credential }) }).catch(() => { throw new ServiceError('NETWORK_ERROR') })
  const body = await response.json().catch(() => null) as { data?: { status: string }, error?: { code?: string } } | null
  if (!response.ok) {
    const code = body?.error?.code
    throw new ServiceError(typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'ACCOUNT_PUBLISH_FAILED', response.status)
  }
  return { provider: input.provider, status: body?.data?.status }
}
