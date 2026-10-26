import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type BrowserContext } from '@playwright/test'
import { stopService } from '../helpers/serviceProcess'

const listen = async(server: net.Server): Promise<number> => await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve((server.address() as net.AddressInfo).port)
  })
})

const close = async(server: net.Server): Promise<void> => {
  if (server.listening) await new Promise(resolve => server.close(resolve))
}

const item = (version: number, index: number) => ({
  recommendationItemId: `recommendation-${version}-${index}`,
  canonicalTrackId: `canonical-${version}-${index}`,
  track: {
    id: `track-${version}-${index}`,
    source: 'kw',
    name: `Mix ${version} Track ${index + 1}`,
    singer: `Artist ${index + 1}`,
    interval: '00:02',
    meta: { songId: `track-${version}-${index}`, albumName: `Album ${index + 1}`, qualitys: ['128k'], _qualitys: { '128k': {} } },
  },
  bucket: index < 21 ? 'new' : 'familiar',
  reason: { type: index < 6 ? ['playlist_cooccurrence', 'artist_affinity', 'album_affinity', 'tag_affinity', 'familiar_replay', 'exploration'][index] : 'exploration', labels: index === 0 ? ['pop'] : [] },
})

const snapshot = (version: number, status: 'ready' | 'degraded' = 'ready') => ({
  status,
  localDate: '2026-08-29',
  version,
  generatedAt: 1_777_593_600_000 + version,
  sourceCoverage: status === 'degraded' ? ['kw'] : ['kw', 'wy'],
  items: Array.from({ length: 30 }, (_, index) => item(version, index)),
})

const installFixtures = async(context: BrowserContext, audio: Buffer, bodies: { resolve: unknown[], history: unknown[] }): Promise<void> => {
  let version = 1
  await context.route('**/api/v1/recommendations/**', async(route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/recommendations/daily' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: snapshot(version, version === 2 ? 'degraded' : 'ready') }) })
    } else if (pathname === '/api/v1/recommendations/daily/refresh') {
      version = 2
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ data: { generationId: 'generation-2', status: 'generating' } }) })
    } else if (pathname === '/api/v1/recommendations/feedback') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { feedbackId: 'feedback-1', active: true, type: 'not_interested_track' } }) })
    } else {
      await route.fallback()
    }
  })
  await context.route('**/api/v1/playback/tracks/resolve', async(route) => {
    bodies.resolve.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { url: '/api/v1/streams/recommendation-e2e', quality: '128k', expiresAt: Date.now() + 60_000 } }) })
  })
  await context.route('**/api/v1/streams/recommendation-e2e', async(route) => {
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: audio })
  })
  await context.route('**/api/v1/playback/history', async(route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    bodies.history.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { playbackId: 'play-1' } }) })
  })
}

test('daily recommendations replace fully, preserve attribution, and remain responsive', async({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendations-ui-'))
  const portServer = net.createServer()
  const port = await listen(portServer)
  await close(portServer)
  const origin = `http://127.0.0.1:${port}`
  const audio = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
  let service: ChildProcess | undefined
  const diagnostics: string[] = []
  try {
    service = spawn(process.execPath, ['dist/server/index.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TUNEFLOW_HOST: '127.0.0.1',
        TUNEFLOW_PORT: String(port),
        TUNEFLOW_STORAGE_ROOT: path.join(root, 'storage'),
        TUNEFLOW_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
        TUNEFLOW_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
      },
      stdio: 'ignore',
    })
    await expect.poll(async() => {
      try { return (await fetch(`${origin}/api/v1/health`)).status } catch { return 0 }
    }).toBe(200)
    await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'en-us', 'common.isShowAnimation': false }),
    })

    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport })
      const bodies: { resolve: unknown[], history: unknown[] } = { resolve: [], history: [] }
      await installFixtures(context, audio, bodies)
      const page = await context.newPage()
      page.on('pageerror', error => diagnostics.push(`${viewport.width}:pageerror:${error.message}`))
      page.on('console', message => { if (message.type() === 'error') diagnostics.push(`${viewport.width}:console:${message.text()}`) })
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.locator('#root').waitFor({ state: 'visible' })
      await page.getByRole('tab', { name: 'Daily Mix' }).click()
      await expect(page.getByTestId('recommendations-page')).toBeVisible()
      await expect(page.locator('[data-recommendation-id]')).toHaveCount(30)
      await expect(page.getByText('New', { exact: true })).toHaveCount(21)
      await expect(page.getByText('Familiar', { exact: true })).toHaveCount(9)
      const navBox = await page.getByRole('tab', { name: 'Daily Mix' }).boundingBox()
      expect(navBox?.height).toBeGreaterThanOrEqual(44)

      if (viewport.width === 1440) {
        await page.getByText('Mix 1 Track 1', { exact: true }).click()
        await expect.poll(() => bodies.resolve.length).toBeGreaterThanOrEqual(1)
        await expect.poll(() => bodies.history.length).toBe(1)
        expect(bodies.resolve).toEqual(expect.arrayContaining([expect.objectContaining({ recommendationItemId: 'recommendation-1-0' })]))
        expect(bodies.resolve.every(body => (body as { recommendationItemId?: string }).recommendationItemId === 'recommendation-1-0')).toBe(true)
        expect(bodies.history[0]).toMatchObject({ recommendationItemId: 'recommendation-1-0' })
        await page.locator('[data-recommendation-id="recommendation-1-1"]').getByRole('button', { name: 'Not interested' }).click()
        await expect(page.locator('[data-recommendation-id="recommendation-1-1"]')).toHaveCount(0)
        await page.getByTestId('recommendations-refresh').click()
        await expect(page.getByText('Generating', { exact: true })).toBeVisible()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByRole('tab', { name: 'Daily Mix' }).click()
        await expect(page.getByText('Mix 2 Track 1', { exact: true })).toBeVisible()
        await expect(page.getByText('Mix 1 Track 1', { exact: true })).toHaveCount(0)
        await expect(page.getByText(/Some music sources are unavailable/)).toBeVisible()
      }
      await context.close()
    }
    expect(diagnostics).toEqual([])
  } finally {
    await stopService(service)
    rmSync(root, { recursive: true, force: true })
  }
})
