import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { afterAll, describe, expect, it } from 'vitest'

const DURATION_SECONDS = 70
const SAMPLE_RATE = 44_100
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2

const createWave = (): Buffer => {
  const dataSize = DURATION_SECONDS * SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
  const wave = Buffer.alloc(44 + dataSize)
  wave.write('RIFF', 0)
  wave.writeUInt32LE(36 + dataSize, 4)
  wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(CHANNELS, 22)
  wave.writeUInt32LE(SAMPLE_RATE, 24)
  wave.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28)
  wave.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32)
  wave.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34)
  wave.write('data', 36)
  wave.writeUInt32LE(dataSize, 40)
  return wave
}

const wave = createWave()

const providerResult = JSON.stringify({
  TOTAL: '2',
  SHOW: '2',
  abslist: [
    {
      MUSICRID: 'MUSIC_fixture-one',
      SONGNAME: 'Fixture playback one',
      ARTIST: 'Fixture artist',
      ALBUMID: 'fixture-album',
      ALBUM: 'Fixture album',
      DURATION: String(DURATION_SECONDS),
      N_MINFO: 'level:128k,bitrate:128,format:wav,size:12m',
    },
    {
      MUSICRID: 'MUSIC_fixture-two',
      SONGNAME: 'Fixture playback two',
      ARTIST: 'Fixture artist',
      ALBUMID: 'fixture-album',
      ALBUM: 'Fixture album',
      DURATION: String(DURATION_SECONDS),
      N_MINFO: 'level:128k,bitrate:128,format:wav,size:12m',
    },
  ],
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
  await expect.poll(async() => {
    try { return (await fetch(`${origin}/api/v1/health`)).status } catch { return 0 }
  }, { timeout: 15_000, intervals: [50, 100, 200, 400] }).toBe(200)
}

const installAudioProbe = async(page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio
    const audios: HTMLAudioElement[] = []
    Object.defineProperty(window, '__lxSmokeAudios', { value: audios })
    const TrackingAudio = function(this: unknown, src?: string): HTMLAudioElement {
      const audio = new NativeAudio(src)
      audios.push(audio)
      return audio
    }
    TrackingAudio.prototype = NativeAudio.prototype
    Object.defineProperty(window, 'Audio', { configurable: true, value: TrackingAudio })
  })
}

const audioState = async(page: Page): Promise<{ currentTime: number, duration: number, paused: boolean, src: string }> => page.evaluate(() => {
  const audios = (window as unknown as { __lxSmokeAudios: HTMLAudioElement[] }).__lxSmokeAudios
  const audio = audios.find(item => {
    const src = item.currentSrc || item.src
    return src.includes('/api/v1/streams/') || src.includes('/api/v1/library/')
  }) ?? audios[0]
  if (audio == null) return { currentTime: 0, duration: 0, paused: true, src: '' }
  return { currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused, src: audio.currentSrc || audio.src }
})

describe('Task 5 production Web prepared Service playback UI smoke', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lx-task5-ui-'))
  const storageRoot = path.join(root, 'storage')
  let sourceServer: http.Server | undefined
  let providerProxy: http.Server | undefined
  let audioServer: http.Server | undefined
  let service: ChildProcess | undefined

  const startService = async(originPort: number, proxyPort: number): Promise<void> => {
    service = spawn(process.execPath, ['dist/server/index.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LX_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1',
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        LX_HOST: '127.0.0.1',
        LX_PORT: String(originPort),
        LX_STORAGE_ROOT: storageRoot,
        LX_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
        LX_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
      },
      stdio: 'ignore',
    })
    await waitForHealth(`http://127.0.0.1:${originPort}`)
  }

  const restartService = async(originPort: number, proxyPort: number): Promise<void> => {
    if (service != null && service.exitCode == null) {
      service.kill('SIGTERM')
      await new Promise<void>(resolve => service!.once('exit', () => { resolve() }))
    }
    await startService(originPort, proxyPort)
  }

  afterAll(async() => {
    if (service != null && service.exitCode == null) {
      service.kill('SIGTERM')
      await new Promise<void>(resolve => service!.once('exit', () => { resolve() }))
    }
    await close(audioServer)
    await close(providerProxy)
    await close(sourceServer)
    rmSync(root, { recursive: true, force: true })
  })

  it('searches, plays, pauses, seeks past 30s, skips, refreshes, and replays through same-origin streams', async() => {
    const localAudioDir = path.join(storageRoot, 'audio')
    mkdirSync(localAudioDir, { recursive: true })
    writeFileSync(path.join(localAudioDir, 'local-fixture.wav'), wave)
    const upstreamRanges: string[] = []
    audioServer = http.createServer((request, response) => {
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined
      if (range != null) upstreamRanges.push(range)
      const match = range == null ? null : /^bytes=(\d+)-(\d*)$/.exec(range)
      const start = match == null ? 0 : Number(match[1])
      const end = match == null || match[2] === '' ? wave.length - 1 : Math.min(Number(match[2]), wave.length - 1)
      if ((range != null && match == null) || start > end || start >= wave.length) {
        response.writeHead(416, { 'content-range': `bytes */${wave.length}` })
        response.end()
        return
      }
      response.writeHead(range == null ? 200 : 206, {
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        'content-range': range == null ? undefined : `bytes ${start}-${end}/${wave.length}`,
        'content-type': 'audio/wav',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      let offset = start
      const pump = setInterval(() => {
        if (offset > end || response.destroyed) {
          clearInterval(pump)
          if (!response.destroyed) response.end()
          return
        }
        const next = Math.min(offset + 64 * 1024, end + 1)
        response.write(wave.subarray(offset, next))
        offset = next
      }, 10)
      response.once('close', () => { clearInterval(pump) })
    })
    const audioPort = await listen(audioServer)

    const fixtureSource = `/*\n * @name Task5 playback smoke\n * @description Deterministic source for the prepared Service UI smoke\n * @version 1.0.0\n */
window.lx.on(window.lx.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (source !== 'kw' || action !== 'musicUrl') throw new Error('unexpected source request')
  const id = info && info.musicInfo && info.musicInfo.songmid === 'fixture-two' ? 'two' : 'one'
  return 'http://127.0.0.1:${audioPort}/audio/' + id + '.wav'
})
window.lx.send(window.lx.EVENT_NAMES.inited, {
  sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
})`

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

    providerProxy = http.createServer((_request, response) => {
      response.statusCode = 502
      response.end()
    })
    providerProxy.on('connect', (_request, socket) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => {
        socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(providerResult)}\r\nConnection: close\r\n\r\n${providerResult}`)
      })
    })
    const proxyPort = await listen(providerProxy)

    const portServer = net.createServer()
    const servicePort = await listen(portServer)
    await close(portServer)
    const origin = `http://127.0.0.1:${servicePort}`
    await startService(servicePort, proxyPort)
    expect((await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'en-us' }),
    })).status).toBe(200)

    const browser = await chromium.launch()
    const page = await browser.newPage()
    await installAudioProbe(page)
    const diagnostics: string[] = []
    const streamResponses: Array<{ url: string, status: number, range?: string }> = []
    const libraryStreamResponses: Array<{ url: string, status: number }> = []
    page.on('console', message => diagnostics.push(`console:${message.type()}:${message.text()}`))
    page.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`))
    page.on('response', response => {
      const request = response.request()
      const pathname = new URL(response.url()).pathname
      if (pathname.startsWith('/api/v1/playback/') || pathname.startsWith('/api/v1/streams/')) diagnostics.push(`${request.method()}:${pathname}:${response.status()}`)
      if (pathname.startsWith('/api/v1/streams/')) {
        streamResponses.push({ url: response.url(), status: response.status(), range: request.headers().range })
      }
      if (/^\/api\/v1\/library\/tracks\/[a-f0-9]{64}\/stream$/.test(pathname)) {
        libraryStreamResponses.push({ url: response.url(), status: response.status() })
      }
    })
    try {
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
      await page.getByRole('tab', { name: 'Settings' }).click()
      await page.getByRole('button', { name: 'Music API Management' }).click()
      await page.getByRole('button', { name: 'Import from Network' }).click()
      await page.locator('input[type="url"]').fill(`http://127.0.0.1:${sourcePort}/source.js`)
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      const sourceHeading = page.getByRole('heading', { name: /Task5 playback smoke/ })
      await sourceHeading.waitFor({ state: 'visible' })
      await sourceHeading.locator('xpath=ancestor::main/preceding-sibling::header/button').click()
      await sourceHeading.waitFor({ state: 'detached' })
      await page.getByRole('radio', { name: /Task5 playback smoke/ }).press('Enter')
      await expect.poll(async() => {
        const response = await fetch(`${origin}/api/v1/sources`)
        const body = await response.json() as { data: Array<{ active: boolean }> }
        return body.data.some(source => source.active)
      }, { timeout: 15_000 }).toBe(true)

      await page.goto(`${origin}/#/search?source=kw&type=music&text=fixture`, { waitUntil: 'networkidle' })
      const firstTrack = page.getByText('Fixture playback one', { exact: true })
      await firstTrack.waitFor({ state: 'visible', timeout: 15_000 })
      const firstRow = firstTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]')
      const secondTrack = page.getByText('Fixture playback two', { exact: true })
      const secondRow = secondTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]')
      await firstRow.dblclick()
      await new Promise(resolve => setTimeout(resolve, 2_000))
      const stateAfterPlay = await audioState(page)
      if (stateAfterPlay.src === '' || stateAfterPlay.paused) throw new Error(`Playback did not remain playing: ${JSON.stringify(stateAfterPlay)}\n${diagnostics.join('\n')}\nupstream=${upstreamRanges.join(',')}`)
      await expect.poll(async() => (await audioState(page)).duration, { timeout: 15_000 }).toBeGreaterThanOrEqual(60)

      await page.getByLabel('Pause', { exact: true }).click()
      await expect.poll(async() => (await audioState(page)).paused).toBe(true)

      await page.locator('#player').getByText('01:10', { exact: true }).hover()
      const progress = page.locator('div[aria-hidden="false"] > div.scroll > div > div:last-child')
      await progress.waitFor({ state: 'visible' })
      await progress.click({ position: { x: 180, y: 7 } })
      await expect.poll(async() => (await audioState(page)).currentTime, { timeout: 10_000 }).toBeGreaterThan(30)
      await expect.poll(() => streamResponses.some(item => item.status === 206 && /^bytes=[1-9]\d{6,}-/.test(item.range ?? '')), { timeout: 10_000 }).toBe(true)

      await secondRow.dblclick()
      await page.locator('#player').getByLabel(/^Fixture playback two/).waitFor({ state: 'visible' })
      await expect.poll(() => new Set(streamResponses.map(item => item.url)).size, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
      await expect.poll(async() => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false)

      await page.reload({ waitUntil: 'networkidle' })
      await secondTrack.waitFor({ state: 'visible', timeout: 15_000 })
      const beforeReplay = new Set(streamResponses.map(item => item.url)).size
      await secondTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
      await expect.poll(() => new Set(streamResponses.map(item => item.url)).size, { timeout: 15_000 }).toBeGreaterThan(beforeReplay)
      await expect.poll(async() => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false)

      expect(streamResponses.length).toBeGreaterThan(2)
      expect(streamResponses.every(item => new URL(item.url).origin === origin)).toBe(true)
      expect(upstreamRanges.some(range => /^bytes=[1-9]\d{6,}-/.test(range))).toBe(true)

      // This stays on the original Web UI path: the renderer fetches the browser-safe
      // library DTO, reconciles it into the default list, and the normal double-click
      // playback action must use the Service-owned opaque library stream URL.
      await page.goto(`${origin}/#/list`, { waitUntil: 'networkidle' })
      const localTrack = page.getByText('local-fixture', { exact: true })
      await localTrack.waitFor({ state: 'visible', timeout: 15_000 })
      expect((await page.content()).includes(storageRoot)).toBe(false)
      expect(await localTrack.count()).toBe(1)
      const beforeLocalPlay = libraryStreamResponses.length
      await localTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
      await expect.poll(() => libraryStreamResponses.length, { timeout: 15_000 }).toBeGreaterThan(beforeLocalPlay)
      await expect.poll(async() => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false)
      const firstLibraryStream = libraryStreamResponses.at(-1)!
      expect(firstLibraryStream.status).toBeGreaterThanOrEqual(200)
      expect(firstLibraryStream.status).toBeLessThan(300)
      expect(new URL(firstLibraryStream.url).origin).toBe(origin)

      await restartService(servicePort, proxyPort)
      await page.goto(`${origin}/#/list`, { waitUntil: 'networkidle' })
      const restartedLocalTrack = page.getByText('local-fixture', { exact: true })
      await restartedLocalTrack.waitFor({ state: 'visible', timeout: 15_000 })
      expect(await restartedLocalTrack.count()).toBe(1)
      await restartedLocalTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
      await page.locator('#player').getByLabel(/^local-fixture/).waitFor({ state: 'visible' })
      await expect.poll(async() => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false)
      // Chromium may satisfy the replay from its media cache because the stable opaque
      // URL is deliberately identical across the restart. The UI state proves the
      // normal playback route; this HEAD proves the restarted Service still owns it.
      const replayState = await audioState(page)
      expect(replayState.src).toBe(firstLibraryStream.url)
      const restartedHead = await fetch(firstLibraryStream.url, { method: 'HEAD' })
      expect(restartedHead.status).toBeGreaterThanOrEqual(200)
      expect(restartedHead.status).toBeLessThan(300)
      expect(libraryStreamResponses.at(-1)!.url).toBe(firstLibraryStream.url)
    } finally {
      await browser.close()
    }
  }, 60_000)
})
