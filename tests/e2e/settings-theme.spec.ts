import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
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

const waitForApp = async(page: Page): Promise<void> => {
  await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 })
  await expect.poll(async() => page.locator('html').getAttribute('data-theme-id')).not.toBeNull()
}

const createWave = (): Buffer => {
  const sampleRate = 8_000
  const dataSize = sampleRate * 2
  const wave = Buffer.alloc(44 + dataSize)
  wave.write('RIFF', 0)
  wave.writeUInt32LE(36 + dataSize, 4)
  wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * 2, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write('data', 36)
  wave.writeUInt32LE(dataSize, 40)
  return wave
}

test('production Web gates desktop features and retains a built-in theme at all required viewports', async({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-task7-ui-'))
  let service: ChildProcess | undefined

  try {
    const portServer = net.createServer()
    const port = await listen(portServer)
    await close(portServer)
    const origin = `http://127.0.0.1:${port}`
    const audioRoot = path.join(root, 'storage', 'audio')
    mkdirSync(audioRoot, { recursive: true })
    writeFileSync(path.join(audioRoot, 'task7-detail.wav'), createWave())

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
    }, { timeout: 15_000 }).toBe(200)
    expect((await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'common.isAgreePact': true,
        'common.langId': 'en-us',
        'common.isShowAnimation': false,
        'common.randomAnimate': false,
        'theme.id': 'green',
      }),
    })).status).toBe(200)

    const diagnostics: string[] = []
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      page.on('pageerror', error => diagnostics.push(`${viewport.width}:pageerror:${error.message}`))
      page.on('console', message => {
        if (message.type() == 'error') diagnostics.push(`${viewport.width}:console:error:${message.text()}`)
      })

      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      expect(await page.getByTestId('window-controls').count()).toBe(0)
      const expectedSidebarWidth = viewport.width <= 600 ? 56 : 64
      const sidebarBox = await page.locator('#left').boundingBox()
      const sidebarIconBox = await page.locator('#left svg').first().boundingBox()
      const sidebarHitBox = await page.locator('#left [role=tab]').first().boundingBox()
      expect(sidebarBox?.width).toBe(expectedSidebarWidth)
      expect(sidebarIconBox?.width).toBe(viewport.width <= 600 ? 24 : 28)
      expect(sidebarIconBox?.height).toBe(viewport.width <= 600 ? 24 : 28)
      expect(sidebarHitBox?.width).toBe(expectedSidebarWidth)
      expect(sidebarHitBox?.height).toBeGreaterThanOrEqual(44)

      if (viewport.width == 1440) {
        await page.goto(`${origin}/#/list`, { waitUntil: 'domcontentloaded' })
        const detailTrack = page.getByText('task7-detail', { exact: true })
        await detailTrack.waitFor({ state: 'visible' })
        await detailTrack.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').dblclick()
        await page.getByTestId('show-player-detail').click()
        await page.getByTestId('play-detail').waitFor({ state: 'visible' })
        expect(await page.getByTestId('play-detail-window-control').count()).toBe(0)
        expect(await page.getByTestId('play-detail-hide').count()).toBe(1)
        await page.getByTestId('play-detail-hide').click()
        await page.getByTestId('play-detail').waitFor({ state: 'detached' })
      }

      await page.getByRole('tab', { name: 'Settings' }).click()
      for (const name of ['SettingDesktopLyric', 'SettingSync', 'SettingOpenAPI', 'SettingBackup', 'SettingUpdate']) {
        await expect(page.getByTestId(`settings-tab-${name}`)).toHaveCount(0)
      }
      await page.getByTestId('settings-tab-SettingDownload').click()
      await expect(page.getByText('Download path', { exact: true })).toHaveCount(0)
      await page.getByTestId('settings-tab-SettingBasic').click()
      await page.getByRole('button', { name: 'Music API Management' }).click()
      await expect(page.getByRole('button', { name: 'Import from Network' })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Import from Local File' })).toHaveCount(0)
      await page.getByTestId('modal').locator('header button').click()
      await page.getByTestId('modal').waitFor({ state: 'detached' })
      await page.getByTestId('theme-more').click()
      await page.getByTestId('theme-black').click()
      await expect.poll(async() => page.locator('html').getAttribute('data-theme-id')).toBe('black')
      await expect.poll(async() => {
        const response = await fetch(`${origin}/api/v1/settings`)
        const body = await response.json() as { data: { 'theme.id': string } }
        return body.data['theme.id']
      }).toBe('black')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      await expect.poll(async() => page.locator('html').getAttribute('data-theme-id')).toBe('black')
      await page.getByRole('tab', { name: 'Settings' }).click()

      await page.getByTestId('settings-tab-SettingHotKey').click()
      expect(await page.getByTestId('settings-hotkeys-local').count()).toBe(1)
      expect(await page.getByTestId('settings-hotkeys-global').count()).toBe(0)

      for (const name of ['SettingDesktopLyric', 'SettingSync', 'SettingOpenAPI', 'SettingBackup', 'SettingUpdate']) {
        await page.goto(`${origin}/#/search`, { waitUntil: 'domcontentloaded' })
        await waitForApp(page)
        await page.goto(`${origin}/#/setting?name=${name}`, { waitUntil: 'domcontentloaded' })
        await waitForApp(page)
        await expect(page.getByTestId('settings-tab-SettingBasic')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByTestId('unsupported-capability')).toHaveCount(0)
      }

      await page.getByTestId('settings-tab-SettingBasic').click()
      const settingsContent = page.getByTestId('settings-content')
      if (viewport.width == 390) {
        await settingsContent.evaluate(element => { element.scrollTop = element.scrollHeight })
        expect(await settingsContent.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      }
      const playerBox = await page.locator('#player').boundingBox()
      expect(playerBox).not.toBeNull()
      expect(playerBox!.y).toBeLessThan(viewport.height)
      expect(playerBox!.y + playerBox!.height).toBeGreaterThan(0)

      if (viewport.width == 390) {
        await page.getByTestId('settings-tab-SettingBasic').click()
        await page.getByTestId('theme-more').click()
        await page.getByTestId('theme-auto').click({ button: 'right' })
        const modal = page.getByTestId('modal')
        await modal.waitFor({ state: 'visible' })
        const box = await modal.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
      }

      await context.close()
    }
    expect(diagnostics).toEqual([])
  } finally {
    await stopService(service)
    rmSync(root, { recursive: true, force: true })
  }
})
