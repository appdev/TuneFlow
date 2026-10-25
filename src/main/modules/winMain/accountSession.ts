import { app, session, type Session } from 'electron'
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readAccountData, writeAccountData } from './accountStorage'

type Provider = 'tx' | 'wy' | 'kg'
const config = {
  tx: { legacy: 'qmusic-account-qq', domains: ['qq.com', 'weixin.qq.com', 'weixin.com', 'qcloud.com', 'gtimg.com'] },
  wy: { legacy: 'qmusic-account-netease', domains: ['163.com', '126.com', 'netease.com'] },
  kg: { legacy: 'qmusic-account-kugou', domains: ['kugou.com'] },
}
interface State { session: Session, ready: Promise<void>, failed: boolean }
const states = new Map<Provider, State>()
const allowed = (provider: Provider, cookie: Electron.Cookie) => cookie && typeof cookie.domain === 'string' && /^\.?[a-z0-9.-]+$/i.test(cookie.domain) && typeof cookie.name === 'string' && typeof cookie.value === 'string' && typeof cookie.path === 'string' && cookie.path.startsWith('/') && config[provider].domains.some(domain => cookie.domain === domain || cookie.domain?.endsWith(`.${domain}`))
const cookieId = (cookie: Electron.Cookie) => `${cookie.domain}\n${cookie.path}\n${cookie.name}`
const current = (cookie: Electron.Cookie) => cookie.session === true || cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1000
const details = (cookie: Electron.Cookie): Electron.CookiesSetDetails => ({
  url: `https://${cookie.domain?.replace(/^\./, '')}${cookie.path}`,
  name: cookie.name,
  value: cookie.value,
  path: cookie.path,
  ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
  sameSite: cookie.sameSite,
  ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
})
const preserveLegacy = (provider: Provider, folder: string) => {
  const backup = join(app.getPath('userData'), 'account-data', 'legacy-cookies', provider)
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  // Chromium can repair/delete unreadable cookie rows while opening a DB.
  // Keep an untouched app-private copy before asking it to read the old jar.
  for (const location of ['', 'Network']) {
    for (const name of ['Cookies', 'Cookies-wal', 'Cookies-shm', 'Cookies-journal']) {
      const source = join(folder, location, name)
      const destination = join(backup, location ? `Network-${name}` : name)
      if (!existsSync(source) || existsSync(destination)) continue
      copyFileSync(source, destination, constants.COPYFILE_EXCL)
      if (process.platform !== 'win32') chmodSync(destination, 0o600)
    }
  }
}

export const getAccountSession = (provider: Provider): Session => {
  const existing = states.get(provider)
  if (existing) return existing.session
  // In-memory Chromium partition: persistence belongs to our app-private jar,
  // so new web login cookies do not invoke Chromium's OS credential storage.
  const account = session.fromPartition(`qmusic-local-account-${provider}-v1`)
  const state: State = { session: account, ready: Promise.resolve(), failed: false }
  states.set(provider, state)
  state.ready = (async() => {
    const saved = readAccountData<Electron.Cookie[]>(`cookies_${provider}`)
    let cookies = saved
    if (cookies === undefined) {
      const folder = join(app.getPath('userData'), 'Partitions', config[provider].legacy)
      const hasLegacy = existsSync(join(folder, 'Cookies')) || existsSync(join(folder, 'Network', 'Cookies'))
      if (hasLegacy) preserveLegacy(provider, folder)
      // One-time compatibility read, retaining a backup and never explicitly
      // clearing or writing the legacy partition.
      cookies = hasLegacy ? await session.fromPartition(`persist:${config[provider].legacy}`).cookies.get({}).catch(() => []) : []
    }
    if (!Array.isArray(cookies) || cookies.length > 4096) throw new Error('credential_storage')
    const jar = new Map<string, Electron.Cookie>()
    for (const cookie of cookies) {
      if (!allowed(provider, cookie) || !current(cookie)) continue
      await account.cookies.set(details(cookie))
      jar.set(cookieId(cookie), cookie)
    }
    writeAccountData(`cookies_${provider}`, [...jar.values()])
    account.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!allowed(provider, cookie)) return
      if (removed || !current(cookie)) jar.delete(cookieId(cookie))
      else jar.set(cookieId(cookie), cookie)
      try { writeAccountData(`cookies_${provider}`, [...jar.values()]); state.failed = false } catch { state.failed = true }
    })
  })()
  // Keep failures observable to callers without an unhandled startup rejection.
  void state.ready.catch(() => { state.failed = true })
  return account
}
export const readyAccountSession = async(provider: Provider) => {
  const account = getAccountSession(provider)
  const state = states.get(provider)!
  await state.ready
  if (state.failed) throw new Error('credential_storage')
  return account
}
