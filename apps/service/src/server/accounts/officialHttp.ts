import { ApiError } from '../errors'
import type { MusicAccountProvider } from '../../../../../packages/platform-accounts/src/reader'
import type { AccountCredential } from './vault'

const hosts: Record<MusicAccountProvider, string[]> = {
  tx: ['y.qq.com', 'u.y.qq.com', 'c6.y.qq.com', 'c.y.qq.com', 'a.y.qq.com', 'xui.ptlogin2.qq.com', 'ssl.ptlogin2.qq.com', 'ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com', 'graph.qq.com'],
  wy: ['music.163.com', 'interface.music.163.com'],
  kg: ['gateway.kugou.com', 'login-user.kugou.com'],
}
export const credentialNames = {
  tx: ['qqmusic_key', 'qm_keyst', 'musickey', 'qqmusic_uin', 'musicid', 'login_type', 'wxuin', 'uin'],
  wy: ['MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID'],
  kg: [],
}
const validCookieValue = (value: string) => !Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === ';')
const neteaseWebUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
export const sanitizeCredential = (provider: MusicAccountProvider, value: AccountCredential): AccountCredential => {
  const cookies: Record<string, string> = {}
  for (const name of credentialNames[provider]) {
    const entry = value?.cookies?.[name]
    if (typeof entry === 'string' && entry.length <= 8192 && validCookieValue(entry)) cookies[name] = entry
  }
  const dailyKey = provider === 'tx' && /^qmk-[\w-]{12,1024}$/.test(value?.dailyKey ?? '') ? value.dailyKey : undefined
  return { cookies, ...(provider === 'kg' ? { kugou: value?.kugou } : {}), ...(dailyKey ? { dailyKey } : {}) }
}

interface Cookie { name: string, value: string, domain: string, path: string, hostOnly: boolean, expires?: number }
export class OfficialHttp {
  private jar: Cookie[] = []
  constructor(readonly provider: MusicAccountProvider, credential: AccountCredential = { cookies: {} }, private readonly transport: typeof fetch = fetch) {
    const sanitized = sanitizeCredential(provider, credential)
    const domain = provider === 'tx' ? 'y.qq.com' : provider === 'wy' ? 'music.163.com' : 'kugou.com'
    this.jar = Object.entries(sanitized.cookies).map(([name, value]) => ({ name, value, domain, path: '/', hostOnly: false }))
  }

  cookies(url?: string) {
    const target = new URL(url ?? (this.provider === 'tx' ? 'https://y.qq.com/' : 'https://music.163.com/'))
    return this.jar.filter(cookie => (cookie.hostOnly ? target.hostname === cookie.domain : target.hostname === cookie.domain || target.hostname.endsWith(`.${cookie.domain}`)) && target.pathname.startsWith(cookie.path) && (cookie.expires == null || cookie.expires > Date.now()))
  }

  musicCredential(): AccountCredential {
    const url = this.provider === 'tx' ? 'https://y.qq.com/' : 'https://music.163.com/'
    return sanitizeCredential(this.provider, { cookies: Object.fromEntries(this.cookies(url).map(item => [item.name, item.value])) })
  }

  private capture(response: Response, target: URL) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const parts = raw.split(';').map(part => part.trim()); const first = parts.shift()!; const at = first.indexOf('=')
      if (at < 1) continue
      const name = first.slice(0, at); const value = first.slice(at + 1)
      const attrs = Object.fromEntries(parts.map(part => { const at = part.indexOf('='); return at < 0 ? [part.toLowerCase(), ''] : [part.slice(0, at).toLowerCase(), part.slice(at + 1)] }))
      const domain = (attrs.domain ?? target.hostname).replace(/^\./, '').toLowerCase()
      // Cookie domains must both match their issuer and remain within that provider.
      if (domain.split('.').length < 2 || !(target.hostname === domain || target.hostname.endsWith(`.${domain}`))) continue
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || !validCookieValue(value) || value.length > 8192) continue
      const cookie: Cookie = { name, value, domain, path: attrs.path?.startsWith('/') ? attrs.path : '/', hostOnly: attrs.domain == null }
      if (attrs['max-age'] != null) cookie.expires = Date.now() + Number(attrs['max-age']) * 1000
      else if (attrs.expires) cookie.expires = Date.parse(attrs.expires)
      this.jar = this.jar.filter(item => !(item.name === name && item.domain === domain && item.path === cookie.path))
      if (cookie.expires == null || cookie.expires > Date.now()) this.jar.push(cookie)
      if (this.jar.length > 128) throw new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Invalid provider response')
    }
  }

  fetch: typeof fetch = async(input, init = {}) => {
    const target = new URL(String(input))
    if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !hosts[this.provider].includes(target.hostname)) throw new ApiError(400, 'ACCOUNT_TARGET_BLOCKED', 'Unsupported official account target')
    const headers = new Headers(init.headers)
    headers.delete('cookie'); headers.delete('authorization')
    const cookie = this.cookies(target.href).map(item => `${item.name}=${item.value}`).join('; ')
    if (cookie) headers.set('Cookie', cookie)
    if (target.hostname === 'a.y.qq.com' && init.headers) {
      const authorization = new Headers(init.headers).get('authorization')
      if (authorization?.startsWith('Bearer qmk-')) headers.set('Authorization', authorization)
    }
    headers.set('User-Agent', this.provider === 'wy' ? neteaseWebUserAgent : 'Mozilla/5.0 TuneFlow/1.0')
    try {
      const response = await this.transport(target, { ...init, headers, redirect: 'manual', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) })
      this.capture(response, target)
      if (!response.body) return response
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError(502, 'ACCOUNT_RESPONSE_TOO_LARGE', 'Official account response exceeded the size limit') }
        chunks.push(part.value)
      }
      return new Response(new Uint8Array(Buffer.concat(chunks)), { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Official account request failed') }
  }

  async follow(url: string) {
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await this.fetch(url)
      if (response.status < 300 || response.status >= 400) return { response, url }
      const location = response.headers.get('location')
      if (!location) throw new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Invalid authorization redirect')
      url = new URL(location, url).href
    }
    throw new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Too many authorization redirects')
  }
}
