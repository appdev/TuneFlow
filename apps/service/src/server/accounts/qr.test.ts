import { afterEach, expect, it, vi } from 'vitest'
import { createOfficialQr } from './qr'

afterEach(() => { vi.unstubAllGlobals() })
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
