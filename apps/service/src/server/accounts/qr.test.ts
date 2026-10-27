import { afterEach, expect, it, vi } from 'vitest'
import { createOfficialQr } from './qr'
import QRCode from 'qrcode'
import * as weapi from '../../../../../packages/platform-accounts/src/neteaseWeapi'

vi.mock('./neteaseBrowser', () => ({ openNeteaseBrowser: async() => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), close: async() => {} }) }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('uses official encrypted Web requests and one cookie/CSRF session from bootstrap through authorization', async() => {
  const encode = vi.spyOn(QRCode, 'toDataURL')
  const encrypt = vi.spyOn(weapi, 'buildNeteaseWeapiForm')
  let polls = 0
  vi.stubGlobal('fetch', async(input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    expect(headers.get('user-agent')).toContain('Chrome/')
    expect(headers.get('user-agent')).not.toMatch(/TuneFlow|Electron/)
    if (url.pathname === '/') {
      expect(headers.has('cookie')).toBe(false)
      const responseHeaders = new Headers()
      responseHeaders.append('set-cookie', 'NMTID=synthetic-bootstrap; Path=/; Secure')
      responseHeaders.append('set-cookie', '__csrf=synthetic-first; Path=/; Secure')
      return new Response('<html></html>', { headers: responseHeaders })
    }
    expect(url.search).toBe('')
    expect(url.pathname).toMatch(/^\/weapi\/login\/qrcode\//)
    expect(init.method).toBe('POST')
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(headers.get('origin')).toBe('https://music.163.com')
    expect(headers.get('referer')).toBe('https://music.163.com/')
    expect(headers.get('cookie')).toContain('NMTID=synthetic-bootstrap')
    const body = new URLSearchParams(String(init.body))
    expect([...body.keys()].sort()).toEqual(['encSecKey', 'params'])
    expect(body.get('encSecKey')).toMatch(/^[a-f0-9]{256}$/)
    expect(String(init.body)).not.toContain('synthetic-qr-key')
    if (url.pathname.endsWith('/unikey')) {
      expect(encrypt.mock.calls.at(-1)?.[0]).toEqual({ type: 1, csrf_token: 'synthetic-first' })
      return Response.json({ code: 200, unikey: 'synthetic-qr-key' }, { headers: { 'set-cookie': '__csrf=synthetic-second; Path=/; Secure' } })
    }
    expect(url.pathname).toBe('/weapi/login/qrcode/client/login')
    expect(encrypt.mock.calls.at(-1)?.[0]).toEqual({ key: 'synthetic-qr-key', type: 1, csrf_token: polls ? 'synthetic-third' : 'synthetic-second' })
    if (++polls === 1) return Response.json({ code: 802 }, { headers: { 'set-cookie': '__csrf=synthetic-third; Path=/; Secure' } })
    return Response.json({ code: 803 }, { headers: { 'set-cookie': 'MUSIC_U=synthetic-music-session; Path=/; Secure; HttpOnly' } })
  })
  const flow = await createOfficialQr('wy')
  const url = new URL(String(encode.mock.calls[0][0]))
  expect(url.origin + url.pathname).toBe('https://music.163.com/login')
  expect(url.searchParams.get('codekey')).toBe('synthetic-qr-key')
  expect([...url.searchParams.keys()]).toEqual(['codekey'])
  expect(await flow.poll()).toEqual({ status: 'scanned' })
  expect(await flow.poll()).toEqual({ status: 'connected', credential: { cookies: { NMTID: 'synthetic-bootstrap', __csrf: 'synthetic-third', MUSIC_U: 'synthetic-music-session' } } })
})

it('reports NetEase 8821 as required security verification without issuing credentials', async() => {
  vi.stubGlobal('fetch', async(input: string | URL) => new URL(String(input)).pathname.endsWith('/unikey')
    ? Response.json({ code: 200, unikey: 'synthetic-qr-key' })
    : Response.json({ code: 8821, redirectUrl: 'https://private.invalid/verification?ticket=synthetic', cookie: 'MUSIC_U=private' }))
  const flow = await createOfficialQr('wy')
  await expect(flow.poll()).rejects.toMatchObject({ statusCode: 409, code: 'ACCOUNT_VERIFICATION_REQUIRED', details: { phase: 'wy-poll', upstreamStatus: 200, upstreamCode: 8821 } })
})

it('does not carry an earlier QR attempt cookie into a new login session', async() => {
  let bootstraps = 0
  vi.stubGlobal('fetch', async(input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const cookie = new Headers(init.headers).get('cookie')
    if (url.pathname === '/') {
      expect(cookie).toBeNull()
      return new Response('<html></html>', { headers: { 'set-cookie': `NMTID=synthetic-${++bootstraps}; Path=/; Secure` } })
    }
    expect(cookie).toBe(`NMTID=synthetic-${bootstraps}`)
    return Response.json({ code: 200, unikey: `synthetic-qr-key-${bootstraps}` })
  })
  await createOfficialQr('wy'); await createOfficialQr('wy')
  expect(bootstraps).toBe(2)
})

it('stops before key creation if the official Web session cannot initialize', async() => {
  const fetch = vi.fn(async() => new Response('unavailable', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(createOfficialQr('wy')).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_UNAVAILABLE', details: { phase: 'wy-key', upstreamStatus: 503 } })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('identifies an unexpected NetEase polling code without exposing provider credentials or account data', async() => {
  vi.stubGlobal('fetch', async(input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/unikey')) return Response.json({ code: 200, unikey: 'synthetic-qr-key' })
    return Response.json({ code: 405, message: 'private-provider-message', cookie: 'MUSIC_U=synthetic-secret', account: { nickname: 'private-name' } })
  })
  const flow = await createOfficialQr('wy')
  try { await flow.poll(); throw new Error('Expected polling failure') } catch (error: any) {
    expect(error.code).toBe('ACCOUNT_LOGIN_UNAVAILABLE')
    expect(error.details).toEqual({ phase: 'wy-poll', upstreamStatus: 200, upstreamCode: 405 })
    expect(JSON.stringify(error.toBody())).not.toMatch(/synthetic|private/)
  }
})

it('does not reflect a nonnumeric provider code into the error response', async() => {
  vi.stubGlobal('fetch', async() => Response.json({ code: 'private-response-content', unikey: 'private-qr-key' }))
  await expect(createOfficialQr('wy')).rejects.toMatchObject({ details: { phase: 'wy-key', upstreamStatus: 200 } })
})

it('completes QQ Connect without returning general QQ cookies or OAuth tickets', async() => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async(input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); calls.push(url.hostname)
    if (url.pathname === '/cgi-bin/xlogin') return new Response('ptui_version:"1"')
    if (url.pathname === '/ptqrshow') return new Response(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]), { headers: { 'set-cookie': 'qrsig=synthetic; Domain=ptlogin2.qq.com; Path=/' } })
    if (url.pathname === '/ptqrlogin') return new Response("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?ticket=synthetic','0','ok','Fixture')")
    if (url.hostname === 'ssl.ptlogin2.graph.qq.com') return new Response('', { status: 302, headers: { location: 'https://graph.qq.com/oauth2.0/login_jump', 'set-cookie': 'p_skey=synthetic-general-qq; Domain=graph.qq.com; Path=/' } })
    if (url.pathname === '/oauth2.0/login_jump') return new Response('ok')
    if (url.pathname === '/oauth2.0/authorize') {
      const body = new URLSearchParams(String(init.body))
      expect(body.get('g_tk')).toBeTruthy()
      return new Response('', { status: 302, headers: { location: `https://y.qq.com/portal/wx_redirect.html?code=synthetic-ticket&state=${body.get('state')}` } })
    }
    expect(url.hostname).toBe('u.y.qq.com')
    expect(new Headers(init.headers).get('cookie') ?? '').not.toContain('synthetic-general-qq')
    return Response.json({ code: 0, req: { code: 0, data: { musickey: 'synthetic-music-only', musicid: 123456 } } })
  })
  const flow = await createOfficialQr('tx')
  expect(flow.image).toMatch(/^data:image\/png;base64,/)
  const result = await flow.poll()
  expect(result.status).toBe('connected')
  expect(result.credential?.cookies.qqmusic_key).toBe('synthetic-music-only')
  expect(JSON.stringify(result.credential)).not.toMatch(/synthetic-general-qq|synthetic-ticket|qrsig|p_skey/)
  expect(calls).toContain('ssl.ptlogin2.graph.qq.com')
})
