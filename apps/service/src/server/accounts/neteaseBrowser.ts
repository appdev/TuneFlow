import { chromium, type Browser } from 'playwright-core'
import { ApiError } from '../errors'
import { spawn, type ChildProcess } from 'node:child_process'

// Each attempt owns a process and an ephemeral context. No shared profile,
// remote debugging listener, browser cookies on disk or client-supplied URLs.
const origin = 'https://music.163.com'
let active = 0
export const openNeteaseBrowser = async(signal?: AbortSignal) => {
  signal?.throwIfAborted()
  if (active >= 2) throw new ApiError(429, 'ACCOUNT_RATE_LIMIT', 'Too many active official logins; retry later')
  active++
  let browser: Browser | undefined
  let launch: Promise<Browser> | undefined
  let display: ChildProcess | undefined
  let closed = false
  let closeTask: Promise<void> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  const exitCleanup = () => { if (display?.pid && display.exitCode == null && display.signalCode == null) display.kill('SIGKILL') }
  const aborted = () => { void close().catch(() => {}) }
  const close = async(): Promise<void> => {
    if (closeTask) return closeTask
    closed = true
    clearTimeout(expiry)
    signal?.removeEventListener('abort', aborted)
    closeTask = Promise.resolve().then(async() => {
      try { await (browser ?? await launch?.catch(() => undefined))?.close() } finally {
        if (display?.pid && display.exitCode == null && display.signalCode == null) {
          const child = display
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { child.kill('SIGKILL') }, 2000); timer.unref()
            child.once('exit', () => { clearTimeout(timer); resolve() }); child.kill('SIGTERM')
          })
        }
        process.removeListener('exit', exitCleanup)
        active--
      }
    })
    return closeTask
  }
  signal?.addEventListener('abort', aborted, { once: true })
  try {
    const executablePath = process.env.TUNEFLOW_CHROMIUM_EXECUTABLE ?? (process.platform === 'linux' ? '/usr/bin/chromium' : undefined)
    let displayName = process.env.DISPLAY
    if (process.platform === 'linux' && !displayName) {
      process.once('exit', exitCleanup)
      display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
      const child = display
      displayName = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { finish(new Error('Display timeout')) }, 5000)
        const finish = (error?: Error, value?: string) => { clearTimeout(timer); child.removeListener('error', failed); child.removeListener('exit', exited); error ? reject(error) : resolve(value!) }
        const failed = () => { finish(new Error('Display unavailable')) }
        const exited = () => { finish(new Error('Display stopped')) }
        child.once('error', failed); child.once('exit', exited)
        let value = ''
        child.stdio[3]!.on('data', chunk => { value += String(chunk); if (/^\d+\n$/.test(value)) finish(undefined, ':' + value.trim()) })
      })
    }
    if (closed) throw new Error('Login cancelled')
    browser = await (launch = chromium.launch({
      headless: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...(displayName ? { env: { ...process.env, DISPLAY: displayName } } : {}),
      ...(executablePath ? { executablePath } : {}),
      timeout: 20000,
      chromiumSandbox: true,
    }))
    if (closed) { await close(); throw new Error('Login cancelled') }
    browser.once('disconnected', () => { void close().catch(() => {}) })
    display?.once('exit', () => { void close().catch(() => {}) })
    expiry = setTimeout(() => { void close().catch(() => {}) }, 300_000); expiry.unref()
    const context = await browser.newContext({ acceptDownloads: false })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const landing = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 20000 })
    if (!landing?.ok()) throw new Error('Official page unavailable')
    await page.waitForFunction(() => typeof (window as any).asrsea === 'function')
    // The official page initializes device/session cookies through JavaScript.
    await page.waitForFunction(() => document.cookie.split(';').some(value => value.trim().startsWith('sDeviceId=')))
    const fetchOfficial: typeof fetch = async(input, init = {}) => {
      const target = new URL(String(input))
      if (closed) throw new ApiError(409, 'ACCOUNT_LOGIN_EXPIRED', 'Login expired or cancelled')
      if (target.origin !== origin || (target.pathname !== '/' && !['/weapi/login/qrcode/unikey', '/weapi/login/qrcode/client/login'].includes(target.pathname))) {
        throw new ApiError(400, 'ACCOUNT_TARGET_BLOCKED', 'Unsupported official login target')
      }
      init.signal?.throwIfAborted()
      const abort = () => { void close().catch(() => {}) }
      init.signal?.addEventListener('abort', abort, { once: true })
      try {
        const result = target.pathname === '/' ? { status: 200, body: '<html></html>' } : await page.evaluate(async({ url, body }) => {
          const response = await fetch(url, { method: 'POST', body, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
          // QR responses are small; bound memory before returning to Node.
          const text = await response.text()
          if (text.length > 256_000) throw new Error('Official response too large')
          return { status: response.status, body: text }
        }, { url: target.href, body: String(init.body ?? '') })
        const headers = new Headers({ 'Content-Type': target.pathname === '/' ? 'text/html' : 'application/json' })
        for (const cookie of await context.cookies(origin)) {
          headers.append('set-cookie', `${cookie.name}=${cookie.value}; Path=${cookie.path}${cookie.domain.startsWith('.') ? `; Domain=${cookie.domain}` : ''}${cookie.secure ? '; Secure' : ''}${cookie.httpOnly ? '; HttpOnly' : ''}`)
        }
        return new Response(result.body, { status: result.status, headers })
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const failure = /net::(ERR_[A-Z_]+)/.exec(message)?.[1] ?? (init.signal?.aborted === true || /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'REQUEST_FAILED')
        throw new ApiError(502, 'ACCOUNT_LOGIN_UNAVAILABLE', 'Official browser request failed', { phase: 'wy-browser-request', browserFailure: failure })
      } finally { init.signal?.removeEventListener('abort', abort) }
    }
    return { fetch: fetchOfficial, close }
  } catch (error) {
    await close()
    // Browser errors can include URLs and response content. Keep them private.
    const message = error instanceof Error ? error.message : ''
    const browserFailure = /sandbox|namespace/i.test(message) ? 'SANDBOX_BLOCKED' : /display/i.test(message) ? 'DISPLAY_UNAVAILABLE' : /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'INITIALIZATION_FAILED'
    throw new ApiError(502, 'ACCOUNT_LOGIN_UNAVAILABLE', 'Official browser session could not initialize', { phase: 'wy-browser', browserFailure })
  }
}
