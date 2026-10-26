import { createHash, randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { OfficialHttp } from './officialHttp'
import type { AccountCredential } from './vault'
import { ApiError } from '../errors'
import { createKugouApi } from '../../../../../packages/platform-accounts/src/kugouAccount'
import type { MusicAccountProvider } from '../../../../../packages/platform-accounts/src/reader'

export interface QrFlow {
  image: string
  expiresAt: number
  poll: () => Promise<{ status: 'waiting' | 'scanned' | 'expired' | 'connected', credential?: AccountCredential }>
}
const hash33 = (value: string, initial = 0) => { let hash = initial; for (const char of value) hash += (hash << 5) + char.charCodeAt(0); return hash & 0x7fffffff }
const unavailable = (phase = 'qr') => new ApiError(502, 'ACCOUNT_LOGIN_UNAVAILABLE', 'Official login is unavailable; retry or authorize in the app', { phase })
const params = (value: Record<string, string>) => new URLSearchParams(value).toString()

// Official QR endpoints only. QR cookies/tickets never leave this process;
// clients receive an image and an opaque, device-scoped attempt identifier.
export const createOfficialQr = async(provider: MusicAccountProvider): Promise<QrFlow> => {
  const http = new OfficialHttp(provider)
  // Honor the provider's expired state; cap a pending attempt at five minutes.
  const expiresAt = Date.now() + 300_000
  if (provider === 'kg') {
    const api = createKugouApi(http.fetch, value => createHash('md5').update(value).digest('hex'))
    const qr = await api.createQr()
    return {
      image: qr.image,
      expiresAt: qr.expiresAt,
      poll: async() => {
        const result = await api.checkQr(qr)
        return { status: result.status, ...(result.session ? { credential: { cookies: {}, kugou: result.session } } : {}) }
      },
    }
  }
  if (provider === 'wy') {
    const first = await http.fetch('https://music.163.com/api/login/qrcode/unikey?type=1', { method: 'POST' }).then(async response => response.json())
    const key = first.unikey ?? first.data?.unikey
    if (first.code !== 200 || typeof key !== 'string' || !/^[\w-]{8,256}$/.test(key)) throw unavailable()
    const image = await QRCode.toDataURL(`https://music.163.com/login?codekey=${key}`, { margin: 2, width: 256 })
    return {
      image,
      expiresAt,
      poll: async() => {
        const result = await http.fetch(`https://music.163.com/api/login/qrcode/client/login?${params({ key, type: '1' })}`, { method: 'POST' }).then(async response => response.json())
        if (result.code === 803) return { status: 'connected', credential: http.musicCredential() }
        if (result.code === 801) return { status: 'waiting' }
        if (result.code === 802) return { status: 'scanned' }
        if (result.code === 800) return { status: 'expired' }
        throw unavailable()
      },
    }
  }

  const redirect = 'https://graph.qq.com/oauth2.0/login_jump'
  const common = { appid: '716027609', daid: '383', pt_3rd_aid: '100497308', u1: redirect }
  const login = await http.fetch(`https://xui.ptlogin2.qq.com/cgi-bin/xlogin?${params({ ...common, s_url: redirect, style: '40', target: 'self' })}`)
  const html = await login.text()
  const version = /ptui_version:(?:encodeURIComponent\()?"(\d+)"/.exec(html)?.[1] ?? ''
  const loginSig = http.cookies('https://xui.ptlogin2.qq.com/').find(cookie => cookie.name === 'pt_login_sig')?.value ?? ''
  const picture = await http.fetch(`https://ssl.ptlogin2.qq.com/ptqrshow?${params({ ...common, e: '2', l: 'M', s: '3', d: '72', v: '4', t: String(Math.random()) })}`)
  // The official endpoint sometimes omits Content-Type; verify PNG bytes below.
  if (!picture.ok) throw unavailable()
  const bytes = Buffer.from(await picture.arrayBuffer())
  if (bytes.length > 300_000 || bytes.length < 32 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw unavailable()
  const signature = http.cookies('https://ssl.ptlogin2.qq.com/').find(cookie => cookie.name === 'qrsig')?.value
  if (!signature) throw unavailable()
  const image = `data:image/png;base64,${bytes.toString('base64')}`
  const state = randomBytes(24).toString('hex')
  return {
    image,
    expiresAt,
    poll: async() => {
      const body = await http.fetch(`https://ssl.ptlogin2.qq.com/ptqrlogin?${params({ u1: redirect, ptqrtoken: String(hash33(signature)), ptredirect: '0', h: '1', t: '1', g: '1', from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: version, js_type: '1', login_sig: loginSig, pt_uistyle: '40', aid: common.appid, daid: common.daid, pt_3rd_aid: common.pt_3rd_aid, has_onekey: '1' })}`).then(async response => response.text())
      const code = /^\s*ptuiCB\('(\d+)'/.exec(body)?.[1]
      if (code === '66') return { status: 'waiting' }
      if (code === '67') return { status: 'scanned' }
      if (code === '65') return { status: 'expired' }
      if (code !== '0') throw unavailable('qq-poll')
      const callback = /ptuiCB\('[^']*','[^']*','([^']+)'/.exec(body)?.[1]?.replace(/\\x([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
      if (!callback) throw unavailable('qq-callback')
      await http.follow(callback)
      const csrf = http.cookies('https://graph.qq.com/').find(cookie => cookie.name === 'p_skey')?.value
      if (!csrf) throw unavailable('qq-csrf')
      const oauth = await http.fetch('https://graph.qq.com/oauth2.0/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://graph.qq.com/' },
        body: params({ response_type: 'code', client_id: '100497308', redirect_uri: 'https://y.qq.com/portal/wx_redirect.html', scope: 'all', state, switch: '', from_ptlogin: '1', src: '1', update_auth: '1', openapi: '80901010_1030', g_tk: String(hash33(csrf, 5381)), auth_time: String(Date.now()), ui: randomUUID() }),
      })
      const location = oauth.headers.get('location')
      if (!location) throw unavailable('qq-oauth')
      const authorized = new URL(location)
      const authorizationCode = authorized.searchParams.get('code')
      if (authorized.origin !== 'https://y.qq.com' || authorized.pathname !== '/portal/wx_redirect.html' || authorized.searchParams.get('state') !== state || !authorizationCode) throw unavailable('qq-oauth-redirect')
      const result = await http.fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' },
        body: JSON.stringify({ comm: { ct: 24, cv: 0 }, req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code: authorizationCode, strAppid: '100497308' } } }),
      }).then(async response => response.json())
      if (result.code !== 0 || result.req?.code !== 0) throw unavailable('qq-exchange')
      const credential = http.musicCredential()
      const data = result.req?.data
      if (data?.musickey && data?.musicid) Object.assign(credential.cookies, { qqmusic_key: String(data.musickey), musickey: String(data.musickey), qqmusic_uin: String(data.musicid), musicid: String(data.musicid), login_type: '1' })
      return { status: 'connected', credential }
    },
  }
}
