import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { stopService } from '../helpers/serviceProcess'

const DURATION_SECONDS = 70
const SAMPLE_RATE = 44_100
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2
const RESTART_CONSOLE_ERRORS = new Set([
  'Failed to load resource: net::ERR_CONNECTION_REFUSED',
  'Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING',
])
const RESTART_CONSOLE_ERROR_FIRST_LINES = new Set(['WebRuntimeError: Unable to reach TuneFlow Service'])

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

const listen = async(server: net.Server | http.Server): Promise<number> => await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve((server.address() as net.AddressInfo).port)
  })
})

const close = async(server?: net.Server | http.Server): Promise<void> => {
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
    Object.defineProperty(window, '__task8Audios', { value: audios })
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
  const audios = (window as unknown as { __task8Audios: HTMLAudioElement[] }).__task8Audios
  const audio = audios.find(item => (item.currentSrc || item.src).includes('/api/v1/')) ?? audios[0]
  return audio == null
    ? { currentTime: 0, duration: 0, paused: true, src: '' }
    : { currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused, src: audio.currentSrc || audio.src }
})

test('original UI persists search, list, playback, download, library, settings, and theme across Service restart', async({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-task8-e2e-'))
  const storageRoot = path.join(root, 'storage')
  const longWave = createWave()
  const shortMp3 = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
  let sourceServer: http.Server | undefined
  let providerProxy: http.Server | undefined
  let audioServer: http.Server | undefined
  let service: ChildProcess | undefined

  const portServer = net.createServer()
  const servicePort = await listen(portServer)
  await close(portServer)
  const origin = `http://127.0.0.1:${servicePort}`

  const startService = async(proxyPort: number): Promise<void> => {
    service = spawn(process.execPath, ['dist/server/index.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1',
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        TUNEFLOW_HOST: '127.0.0.1',
        TUNEFLOW_PORT: String(servicePort),
        TUNEFLOW_STORAGE_ROOT: storageRoot,
        TUNEFLOW_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
        TUNEFLOW_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
      },
      stdio: 'ignore',
    })
    await waitForHealth(origin)
  }

  try {
    audioServer = http.createServer((request, response) => {
      const bytes = request.url?.includes('download') === true ? shortMp3 : longWave
      const contentType = request.url?.includes('download') === true ? 'audio/mpeg' : 'audio/wav'
      const match = typeof request.headers.range === 'string' ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.range) : null
      const start = match == null ? 0 : Number(match[1])
      const end = match == null || match[2] === '' ? bytes.length - 1 : Math.min(Number(match[2]), bytes.length - 1)
      if (start > end || start >= bytes.length) {
        response.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
        response.end()
        return
      }
      response.writeHead(match == null ? 200 : 206, {
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        ...(match == null ? {} : { 'content-range': `bytes ${start}-${end}/${bytes.length}` }),
        'content-type': contentType,
      })
      if (request.method === 'HEAD') response.end()
      else response.end(bytes.subarray(start, end + 1))
    })
    const audioPort = await listen(audioServer)

    const fixtureSource = `/*\n * @name Task8 production acceptance\n * @description Deterministic source for Server Web E2E\n * @version 1.0.0\n */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (source !== 'kw') throw new Error('unexpected source')
  if (action === 'musicUrl') {
    const id = info && info.musicInfo && info.musicInfo.songmid
    return id === 'task8-download'
      ? 'http://127.0.0.1:${audioPort}/download.mp3'
      : 'http://127.0.0.1:${audioPort}/play.wav'
  }
  if (action === 'lyric') return { lyric: '[00:00.00]Task8 fixture' }
  if (action === 'pic') return 'http://artistpicserver.kuwo.cn/task8.jpg'
  throw new Error('unexpected source action')
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, {
  sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] } },
})`

    sourceServer = http.createServer((request, response) => {
      if (request.url !== '/source.js') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'application/javascript' })
      response.end(fixtureSource)
    })
    const sourcePort = await listen(sourceServer)

    const providerResult = JSON.stringify({
      TOTAL: '2',
      SHOW: '2',
      abslist: [
        { MUSICRID: 'MUSIC_task8-play', SONGNAME: 'Task8 playable', ARTIST: 'Fixture artist', ALBUMID: 'task8', ALBUM: 'Task8', DURATION: '70', N_MINFO: 'level:128k,bitrate:128,format:mp3,size:6m' },
        { MUSICRID: 'MUSIC_task8-download', SONGNAME: 'Task8 downloaded', ARTIST: 'Fixture artist', ALBUMID: 'task8', ALBUM: 'Task8', DURATION: '2', N_MINFO: 'level:128k,bitrate:128,format:mp3,size:2k' },
      ],
    })
    providerProxy = http.createServer((_request, response) => response.writeHead(502).end())
    providerProxy.on('connect', (_request, socket) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(providerResult)}\r\nConnection: close\r\n\r\n${providerResult}`))
    })
    const proxyPort = await listen(providerProxy)
    await startService(proxyPort)

    expect((await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'common.isAgreePact': true,
        'common.langId': 'en-us',
        'common.isShowAnimation': false,
        'common.randomAnimate': false,
        'download.enable': true,
        'download.isEmbedLyric': false,
      }),
    })).status).toBe(200)

    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    await installAudioProbe(page)
    const streamResponses: Array<{ url: string, status: number, range?: string }> = []
    const libraryResponses: Array<{ url: string, status: number }> = []
    const restartDiagnostics: string[] = []
    const diagnostics: string[] = []
    let restartingService = false
    let simulatingFailedPlayback = false
    page.on('pageerror', error => {
      const diagnostic = `pageerror:${error.message}`
      diagnostics.push(diagnostic)
    })
    page.on('console', message => {
      if (message.type() !== 'error') return
      const diagnostic = `console:${message.text()}`
      const firstLine = message.text().split('\n', 1)[0]
      if (restartingService && (RESTART_CONSOLE_ERRORS.has(message.text()) || RESTART_CONSOLE_ERROR_FIRST_LINES.has(firstLine))) restartDiagnostics.push(`console:${firstLine}`)
      else if (!simulatingFailedPlayback || message.text() !== 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)') diagnostics.push(diagnostic)
    })
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname
      if (pathname.startsWith('/api/v1/streams/')) streamResponses.push({ url: response.url(), status: response.status(), range: response.request().headers().range })
      if (/^\/api\/v1\/library\/tracks\/[a-f0-9]{64}\/stream$/.test(pathname)) libraryResponses.push({ url: response.url(), status: response.status() })
    })

    await page.route('http://artistpicserver.kuwo.cn/**', async route => route.fulfill({ body: '', contentType: 'text/plain', status: 200 }))
    await page.route(`${origin}/api/v1/catalog/tracks/search`, async route => {
      const body = route.request().postDataJSON() as { source?: string, page?: number, pageSize?: number }
      if (body.source === 'kw') await route.continue()
      else {
        await route.fulfill({
          contentType: 'application/json',
          status: 200,
          body: JSON.stringify({ data: { list: [], total: 0, limit: body.pageSize ?? 30, page: body.page ?? 1, source: body.source ?? '' } }),
        })
      }
    })
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Music API Management' }).click()
    await page.getByRole('button', { name: 'Import from Network' }).click()
    await page.locator('input[type="url"]').fill(`http://127.0.0.1:${sourcePort}/source.js`)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const sourceHeading = page.getByRole('heading', { name: /Task8 production accepta/ })
    await sourceHeading.waitFor({ state: 'visible' })
    await sourceHeading.locator('xpath=ancestor::main/preceding-sibling::header/button').click()
    await sourceHeading.waitFor({ state: 'detached' })
    await page.getByRole('radio', { name: /Task8 production accepta/ }).press('Enter')
    await expect.poll(async() => ((await (await fetch(`${origin}/api/v1/sources`)).json()) as { data: Array<{ active: boolean }> }).data.some(item => item.active)).toBe(true)

    await page.getByTestId('settings-tab-SettingDownload').click()
    const embedPicSetting = page.locator('#setting_download_isEmbedPic')
    await expect(embedPicSetting).toBeChecked()
    await page.getByRole('checkbox', { name: 'Embed cover' }).click()
    await expect(embedPicSetting).not.toBeChecked()
    await expect.poll(async() => ((await (await fetch(`${origin}/api/v1/settings`)).json()) as { data: { 'download.isEmbedPic': boolean } }).data['download.isEmbedPic']).toBe(false)

    await page.goto(`${origin}/#/list?id=default`, { waitUntil: 'networkidle' })
    await page.getByLabel('Create list').click()
    const newListInput = page.locator('#my-list li input').last()
    await newListInput.fill('Task8 persisted list')
    await newListInput.press('Enter')
    const userList = page.locator('.user-list', { hasText: 'Task8 persisted list' })
    await userList.waitFor({ state: 'visible' })
    await expect.poll(async() => {
      const body = await (await fetch(`${origin}/api/v1/playlists`)).json() as { data: Array<{ id: string, name: string }> }
      return body.data.find(item => item.name === 'Task8 persisted list')?.id ?? ''
    }).not.toBe('')

    await page.goto(`${origin}/#/search?source=kw&type=music&text=task8`, { waitUntil: 'networkidle' })
    const playable = page.getByText('Task8 playable', { exact: true })
    const downloaded = page.getByText('Task8 downloaded', { exact: true })
    await playable.waitFor({ state: 'visible' })
    const playableRow = playable.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]')
    const downloadRow = downloaded.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]')

    await playableRow.click({ button: 'right' })
    await page.getByRole('tab', { name: 'Add to ...', exact: true }).click()
    await page.getByRole('button', { name: 'Add the song(s) to "Task8 persisted list"' }).click()
    await expect.poll(async() => {
      const lists = await (await fetch(`${origin}/api/v1/playlists`)).json() as { data: Array<{ id: string, name: string }> }
      const id = lists.data.find(item => item.name === 'Task8 persisted list')?.id
      if (id == null) return 0
      return ((await (await fetch(`${origin}/api/v1/playlists/${encodeURIComponent(id)}`)).json()) as { data: { tracks: unknown[] } }).data.tracks.length
    }).toBe(1)

    await playableRow.dblclick()
    await expect.poll(async() => (await audioState(page)).duration).toBeGreaterThanOrEqual(60)
    await expect.poll(async() => (await audioState(page)).paused).toBe(false)
    await page.getByLabel('Pause', { exact: true }).click()
    await expect.poll(async() => (await audioState(page)).paused).toBe(true)
    await page.locator('#player').getByText('01:10', { exact: true }).hover()
    const progress = page.locator('div[aria-hidden="false"] > div.scroll > div > div:last-child')
    await progress.waitFor({ state: 'visible' })
    await progress.click({ position: { x: 180, y: 7 } })
    await expect.poll(async() => (await audioState(page)).currentTime).toBeGreaterThan(30)
    await expect.poll(() => streamResponses.some(item => item.status === 206 && /^bytes=[1-9]\d+-/.test(item.range ?? ''))).toBe(true)
    expect(streamResponses.every(item => new URL(item.url).origin === origin)).toBe(true)

    await page.evaluate(() => {
      const target = window as unknown as {
        __task8DownloadEvents?: Array<Array<{ status: string }>>
        tuneFlowWebRuntime: { on: (name: string, listener: (event: { params: Array<{ status: string }> }) => void) => void }
      }
      target.__task8DownloadEvents = []
      target.tuneFlowWebRuntime.on('service_downloads', event => target.__task8DownloadEvents!.push(event.params.map(item => ({ status: item.status }))))
    })
    await downloadRow.click({ button: 'right' })
    await page.getByRole('tab', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /Normal 128K/ }).click()
    await page.goto(`${origin}/#/download`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Task8 downloaded - Fixture artist', { exact: true }).waitFor({ state: 'visible' })
    await page.getByLabel('Download is complete').waitFor({ state: 'visible', timeout: 20_000 })
    await expect.poll(async() => page.evaluate(() => (window as unknown as { __task8DownloadEvents: Array<Array<{ status: string }>> }).__task8DownloadEvents.some(batch => batch.some(item => item.status === 'completed')))).toBe(true)

    await expect.poll(async() => {
      const body = await (await fetch(`${origin}/api/v1/library/tracks`)).json() as { data: Array<{ id: string, name: string, streamUrl: string }> }
      return body.data.find(item => item.name === 'Task8 downloaded - Fixture artist') ?? null
    }, { timeout: 20_000 }).not.toBeNull()

    let rejectNextOnlineStream = true
    simulatingFailedPlayback = true
    await page.route(`${origin}/api/v1/streams/**`, async route => {
      if (!rejectNextOnlineStream) return route.continue()
      rejectNextOnlineStream = false
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'simulated stale playback URL' })
    })
    const localFallbackResponsesBefore = libraryResponses.length
    await page.goto(`${origin}/#/search?source=kw&type=music&text=task8`, { waitUntil: 'networkidle' })
    const downloadedFallback = page.getByText('Task8 downloaded', { exact: true })
    await downloadedFallback.waitFor({ state: 'visible' })
    await downloadedFallback.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
    await expect.poll(() => libraryResponses.slice(localFallbackResponsesBefore).some(item => item.status === 200 || item.status === 206)).toBe(true)
    await expect.poll(async() => (await audioState(page)).src).toMatch(/\/api\/v1\/library\/tracks\/[a-f0-9]{64}\/stream/)
    await page.unroute(`${origin}/api/v1/streams/**`)
    simulatingFailedPlayback = false

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'Your Library' }).click()
    await page.getByLabel('Default', { exact: true }).click()
    const localTrack = page.getByText('Task8 downloaded - Fixture artist', { exact: true })
    await localTrack.waitFor({ state: 'visible' })
    await localTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
    await expect.poll(() => libraryResponses.some(item => item.status === 206)).toBe(true)
    await expect.poll(async() => (await audioState(page)).paused).toBe(false)
    await page.locator('#player').getByLabel('Next', { exact: true }).click()

    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByTestId('settings-tab-SettingBasic').click()
    await page.getByTestId('theme-more').click()
    await page.getByTestId('theme-black').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'black')
    await page.getByTestId('settings-tab-SettingDownload').click()
    await expect(page.locator('#setting_download_isEmbedPic')).not.toBeChecked()

    const listsBeforeRestart = await (await fetch(`${origin}/api/v1/playlists`)).json() as { data: Array<{ id: string, name: string }> }
    expect(listsBeforeRestart.data.some(item => item.name === 'Task8 persisted list')).toBe(true)
    const libraryResponseCountBeforeRestart = libraryResponses.length
    restartingService = true
    await stopService(service)
    await startService(proxyPort)
    await page.reload({ waitUntil: 'networkidle' })
    restartingService = false
    await page.getByRole('tab', { name: 'Your Library' }).click()
    await page.getByLabel('Task8 persisted list', { exact: true }).click()
    await page.getByText('Task8 playable', { exact: true }).waitFor({ state: 'visible' })
    await page.getByLabel('Task8 persisted list').waitFor({ state: 'visible' })
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'black')
    await page.getByLabel('Default', { exact: true }).click()
    const restartedLocalTrack = page.getByText('Task8 downloaded - Fixture artist', { exact: true })
    await restartedLocalTrack.waitFor({ state: 'visible' })
    await restartedLocalTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
    await expect.poll(async() => (await audioState(page)).paused).toBe(false)
    await expect(page.locator('#player')).toContainText('Task8 downloaded - Fixture artist')
    await expect.poll(() => libraryResponses.slice(libraryResponseCountBeforeRestart).some(item => item.status === 206 && new URL(item.url).origin === origin)).toBe(true)
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByTestId('settings-tab-SettingDownload').click()
    await expect(page.locator('#setting_download_isEmbedPic')).not.toBeChecked()
    expect(restartDiagnostics.every(item => RESTART_CONSOLE_ERRORS.has(item.replace(/^console:/, '')) || RESTART_CONSOLE_ERROR_FIRST_LINES.has(item.replace(/^console:/, '')))).toBe(true)
    expect(diagnostics).toEqual([])
    await context.close()
  } finally {
    await stopService(service)
    await close(audioServer)
    await close(providerProxy)
    await close(sourceServer)
    rmSync(root, { recursive: true, force: true })
  }
})
