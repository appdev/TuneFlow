import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chromium } from 'playwright-core'
import { openNeteaseBrowser } from './neteaseBrowser'

vi.mock('playwright-core', () => ({ chromium: { launch: vi.fn() } }))
const sessions: Awaited<ReturnType<typeof openNeteaseBrowser>>[] = []
beforeEach(() => { vi.stubEnv('DISPLAY', ':99') })
afterEach(async() => { await Promise.all(sessions.splice(0).map(async session => session.close())); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks() })
const fixture = () => {
  const page = { setDefaultTimeout: vi.fn(), goto: vi.fn(async() => ({ ok: () => true })), waitForFunction: vi.fn(async() => {}), evaluate: vi.fn(async() => ({ status: 200, body: '{"code":803}' })) }
  const context = { newPage: vi.fn(async() => page), cookies: vi.fn(async() => [{ name: 'MUSIC_U', value: 'synthetic-session', domain: '.music.163.com', path: '/', secure: true, httpOnly: true }]) }
  const browser = { newContext: vi.fn(async() => context), close: vi.fn(async() => {}), once: vi.fn() }
  vi.mocked(chromium.launch).mockResolvedValue(browser as any)
  return { page, context, browser }
}
it('uses an ephemeral isolated context, preserves encrypted body and restricts target URLs', async() => {
  const { page, context } = fixture()
  const session = await openNeteaseBrowser(); sessions.push(session)
  expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }))
  expect(context.newPage).toHaveBeenCalledOnce()
  const response = await session.fetch('https://music.163.com/weapi/login/qrcode/client/login', { method: 'POST', body: 'params=synthetic&encSecKey=synthetic' })
  expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { url: 'https://music.163.com/weapi/login/qrcode/client/login', body: 'params=synthetic&encSecKey=synthetic' })
  expect(await response.json()).toEqual({ code: 803 })
  expect(response.headers.getSetCookie()[0]).toContain('MUSIC_U=synthetic-session')
  await expect(session.fetch('https://attacker.invalid/')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
  await expect(session.fetch('https://music.163.com/weapi/other')).rejects.toMatchObject({ code: 'ACCOUNT_TARGET_BLOCKED' })
})
it('limits simultaneous processes, closes idempotently and recovers capacity', async() => {
  const { browser } = fixture()
  for (let i = 0; i < 2; i++) sessions.push(await openNeteaseBrowser())
  await expect(openNeteaseBrowser()).rejects.toMatchObject({ code: 'ACCOUNT_RATE_LIMIT' })
  await Promise.all([sessions[0].close(), sessions[0].close()])
  expect(browser.close).toHaveBeenCalledTimes(1)
  sessions.push(await openNeteaseBrowser())
  expect(chromium.launch).toHaveBeenCalledTimes(3)
})
it('releases resources after initialization failure without exposing browser errors', async() => {
  const { page, browser } = fixture()
  page.goto.mockRejectedValueOnce(new Error('private-url-and-cookie'))
  await expect(openNeteaseBrowser()).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_UNAVAILABLE', details: { phase: 'wy-browser' } })
  expect(browser.close).toHaveBeenCalledOnce()
  sessions.push(await openNeteaseBrowser())
})
it('cancels initialization and closes a browser that finishes launching after cancellation', async() => {
  const { browser } = fixture()
  let finish!: (value: any) => void
  vi.mocked(chromium.launch).mockImplementationOnce(async() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController()
  const pending = openNeteaseBrowser(controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_UNAVAILABLE' })
  controller.abort()
  finish(browser)
  await rejected
  expect(browser.close).toHaveBeenCalledOnce()
  sessions.push(await openNeteaseBrowser())
})
it('expires idle sessions and aborts in-flight transports', async() => {
  const { browser } = fixture()
  vi.useFakeTimers()
  const session = await openNeteaseBrowser(); sessions.push(session)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(browser.close).toHaveBeenCalledOnce()
  await expect(session.fetch('https://music.163.com/')).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_EXPIRED' })
  const next = await openNeteaseBrowser(); sessions.push(next)
  const signal = AbortSignal.abort()
  await expect(next.fetch('https://music.163.com/', { signal })).rejects.toThrow()
})
