import { rmSync, mkdtempSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { afterAll, describe, expect, it } from 'vitest'

const fixtureSource = `/*
 * @name UI smoke source
 * @description Source used only by the prepared Service browser smoke test
 * @version 1.0.0
 */
window.lx.on(window.lx.EVENT_NAMES.request, async ({ source, action }) => {
  if (source !== 'fixture') throw new Error('unexpected source')
  if (action === 'lyric') return { lyric: 'fixture lyric' }
  throw new Error('unexpected action')
})
window.lx.send(window.lx.EVENT_NAMES.inited, {
  sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } },
})`

const providerResult = JSON.stringify({
  TOTAL: '1',
  SHOW: '1',
  abslist: [{
    MUSICRID: 'MUSIC_fixture-ui',
    SONGNAME: 'Fixture provider UI',
    ARTIST: 'Fixture artist',
    ALBUMID: 'fixture-album',
    ALBUM: 'Fixture album',
    DURATION: '180',
    N_MINFO: 'level:320k,bitrate:320,format:mp3,size:8m',
  }],
})

const listen = async(server: net.Server | http.Server): Promise<number> => await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve((server.address() as net.AddressInfo).port)
  })
})

const close = async(server: net.Server | http.Server | undefined): Promise<void> => {
  if (server?.listening) await new Promise<void>(resolve => server.close(() => { resolve() }))
}

const waitForHealth = async(origin: string): Promise<void> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${origin}/api/v1/health`)).ok) return
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('prepared Service did not become healthy')
}

describe('Task 4 prepared Service UI smoke', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lx-task4-ui-'))
  let sourceServer: http.Server | undefined
  let proxyServer: http.Server | undefined
  let service: ChildProcess | undefined

  afterAll(async() => {
    if (service != null && service.exitCode == null) {
      service.kill('SIGTERM')
      await new Promise<void>(resolve => service!.once('exit', () => { resolve() }))
    }
    await close(proxyServer)
    await close(sourceServer)
    rmSync(root, { recursive: true, force: true })
  })

  it('imports, activates, and searches through the original UI and a CONNECT provider fixture', async() => {
    sourceServer = http.createServer((request, response) => {
      if (request.url !== '/source.js') {
        response.statusCode = 404
        response.end()
        return
      }
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('content-type', 'application/javascript')
      response.end(fixtureSource)
    })
    const sourcePort = await listen(sourceServer)

    proxyServer = http.createServer((_request, response) => {
      response.statusCode = 502
      response.end()
    })
    proxyServer.on('connect', (_request, socket) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => {
        socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(providerResult)}\r\nConnection: close\r\n\r\n${providerResult}`)
      })
    })
    const proxyPort = await listen(proxyServer)

    const portServer = net.createServer()
    const servicePort = await listen(portServer)
    await close(portServer)
    const origin = `http://127.0.0.1:${servicePort}`
    service = spawn(process.execPath, ['dist/server/index.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        LX_HOST: '127.0.0.1',
        LX_PORT: String(servicePort),
        LX_STORAGE_ROOT: path.join(root, 'storage'),
        LX_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
        LX_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
      },
      stdio: 'ignore',
    })
    await waitForHealth(origin)
    expect((await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'en-us' }),
    })).ok).toBe(true)

    const browser = await chromium.launch()
    const page = await browser.newPage()
    let activationRequests = 0
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/sources/active') activationRequests++
    })
    try {
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
      await page.getByRole('tab', { name: 'Settings' }).click()
      const manage = page.getByRole('button', { name: 'Music API Management' })
      await manage.waitFor({ state: 'visible' })
      await manage.click()
      await page.getByRole('button', { name: 'Import from Network' }).click()
      await page.locator('input[type="url"]').fill(`http://127.0.0.1:${sourcePort}/source.js`)
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      await page.getByRole('heading', { name: /UI smoke source/ }).waitFor({ state: 'visible' })
      const closeSourceManager = page.getByRole('heading', { name: /UI smoke source/ }).locator('xpath=ancestor::main/preceding-sibling::header/button')
      await closeSourceManager.click()
      await page.getByRole('heading', { name: /UI smoke source/ }).waitFor({ state: 'detached' })
      await page.getByRole('radio', { name: /UI smoke source/ }).press('Enter')
      await expect.poll(async() => {
        const data = await (await fetch(`${origin}/api/v1/settings`)).json() as { data: { 'common.apiSource': string } }
        return data.data['common.apiSource']
      }, { timeout: 15_000 }).toMatch(/^user_api_/)
      await expect.poll(async() => {
        const data = await (await fetch(`${origin}/api/v1/sources`)).json() as { data: Array<{ active: boolean }> }
        return data.data.some(source => source.active)
      }, { timeout: 15_000 }).toBe(true)
      expect(activationRequests).toBeGreaterThan(0)

      await page.goto(`${origin}/#/search?source=kw&type=music&text=fixture`, { waitUntil: 'networkidle' })
      await page.getByText('Fixture provider UI').waitFor({ state: 'visible', timeout: 15_000 })
    } finally {
      await browser.close()
    }
  }, 45_000)
})
