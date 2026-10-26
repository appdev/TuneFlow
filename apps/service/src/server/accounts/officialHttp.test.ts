import { describe, expect, it, vi } from 'vitest'
import { OfficialHttp, sanitizeCredential } from './officialHttp'
describe('official account network boundary', () => {
  it('bounds official responses before parsing or retaining provider data', async() => {
    const http = new OfficialHttp('tx', { cookies: {} }, vi.fn(async() => new Response(new Uint8Array(2 * 1024 * 1024 + 1))) as typeof fetch)
    await expect(http.fetch('https://y.qq.com/')).rejects.toMatchObject({ code: 'ACCOUNT_RESPONSE_TOO_LARGE' })
  })
  it('allows the exact QQ Connect callback host without allowing arbitrary QQ subdomains', async() => {
    const http = new OfficialHttp('tx', { cookies: {} }, vi.fn(async() => new Response('ok')) as typeof fetch)
    expect((await http.fetch('https://ssl.ptlogin2.graph.qq.com/check_sig')).ok).toBe(true)
    await expect(http.fetch('https://untrusted.graph.qq.com/check_sig')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
  })
  it('keeps only music credentials and blocks redirects/hosts before attaching secrets', async() => {
    expect(sanitizeCredential('tx', { cookies: { skey: 'qq-general', p_skey: 'qq-general', qqmusic_key: 'synthetic', uin: '1234', evil: 'no' } })).toEqual({ cookies: { qqmusic_key: 'synthetic', uin: '1234' } })
    const calls: string[] = []; const transport = vi.fn(async(input, init) => { calls.push(String(input)); expect(init.headers.get('Cookie')).toContain('qqmusic_key=synthetic'); return new Response('', { status: 302, headers: { location: 'https://attacker.invalid/steal' } }) })
    const http = new OfficialHttp('tx', { cookies: { qqmusic_key: 'synthetic' } }, transport as typeof fetch)
    await expect(http.follow('https://y.qq.com/')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
    expect(calls).toEqual(['https://y.qq.com/'])
    await expect(http.fetch('http://y.qq.com/')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
    await expect(http.fetch('https://u.y.qq.com.attacker.invalid/')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
  })
  it('does not leak music cookies to QQ OAuth and preserves issuer cookie domains', async() => {
    const transport = vi.fn(async(input, init) => {
      if (String(input).startsWith('https://ssl.ptlogin2.qq.com/')) {
        expect(init.headers.has('Cookie')).toBe(false)
        return new Response('ok', { headers: { 'set-cookie': 'qrsig=fixture; Domain=ptlogin2.qq.com; Path=/; HttpOnly' } })
      }
      expect(init.headers.get('Cookie')).toContain('qrsig=fixture')
      expect(init.headers.get('Cookie')).not.toContain('qqmusic_key')
      return new Response('ok')
    })
    const http = new OfficialHttp('tx', { cookies: { qqmusic_key: 'synthetic' } }, transport as typeof fetch)
    await http.fetch('https://ssl.ptlogin2.qq.com/ptqrshow'); await http.fetch('https://xui.ptlogin2.qq.com/ssl/ptqrlogin')
    expect(http.musicCredential()).toEqual({ cookies: { qqmusic_key: 'synthetic' } })
  })
})
