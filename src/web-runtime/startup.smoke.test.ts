import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path, { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../server/app'

const distRoot = resolve(process.cwd(), 'dist/web')
const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'lx-web-smoke-'))
process.env.LX_SERVICE_NODE_MODULES = path.join(process.cwd(), 'dist/server/node_modules')
let server: Awaited<ReturnType<typeof createServer>>
let origin = ''

describe('web production startup', () => {
  beforeAll(async() => {
    server = await createServer({ storageRoot, webRoot: distRoot, host: '127.0.0.1', port: 0 })
    origin = await server.listen({ host: '127.0.0.1', port: 0 })
  })

  afterAll(async() => {
    await server.close()
    rmSync(storageRoot, { recursive: true, force: true })
  })

  it('renders the root URL without page errors', async() => {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    const pageErrors: string[] = []
    const exceptions: string[] = []
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Runtime.enable')
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
    cdp.on('Runtime.exceptionThrown', event => exceptions.push(JSON.stringify(event.exceptionDetails)))

    try {
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
      expect(exceptions).toEqual([])
      expect(pageErrors).toEqual([])
      expect(await page.locator('#root').isVisible()).toBe(true)
      expect(await page.evaluate(() => {
        const root = document.getElementById('root')!
        const htmlStyle = getComputedStyle(document.documentElement)
        const rootStyle = getComputedStyle(root)
        const rootRect = root.getBoundingClientRect()
        return {
          htmlPadding: htmlStyle.padding,
          rootRect: {
            x: rootRect.x,
            y: rootRect.y,
            width: rootRect.width,
            height: rootRect.height,
          },
          rootBorderRadius: rootStyle.borderRadius,
          rootBoxShadow: rootStyle.boxShadow,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }
      })).toEqual({
        htmlPadding: '0px',
        rootRect: { x: 0, y: 0, width: 1280, height: 720 },
        rootBorderRadius: '0px',
        rootBoxShadow: 'none',
        viewport: { width: 1280, height: 720 },
      })
    } finally {
      await cdp.detach()
      await browser.close()
    }
  }, 30_000)
})
