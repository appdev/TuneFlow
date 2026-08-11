import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { stopService } from './helpers/serviceProcess'

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

test('production Web removes desktop file actions while retaining network, play, and remove actions', async({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lx-web-only-ui-'))
  const storageRoot = path.join(root, 'storage')
  const audio = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
  let audioServer: http.Server | undefined
  let service: ChildProcess | undefined

  const portServer = net.createServer()
  const servicePort = await listen(portServer)
  await close(portServer)
  const origin = `http://127.0.0.1:${servicePort}`

  try {
    audioServer = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': audio.length, 'content-type': 'audio/mpeg' })
      response.end(audio)
    })
    const audioPort = await listen(audioServer)

    service = spawn(process.execPath, ['dist/server/index.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LX_HOST: '127.0.0.1',
        LX_PORT: String(servicePort),
        LX_STORAGE_ROOT: storageRoot,
        LX_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
        LX_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
      },
      stdio: 'ignore',
    })
    await waitForHealth(origin)

    const sourceScript = `/*\n * @name Web only UI fixture\n * @description Deterministic completed download for production UI evidence\n * @version 1.0.0\n */
window.lx.on(window.lx.EVENT_NAMES.request, async ({ source, action }) => {
  if (source !== 'fixture' || action !== 'musicUrl') throw new Error('unexpected source request')
  return 'http://127.0.0.1:${audioPort}/download.mp3'
})
window.lx.send(window.lx.EVENT_NAMES.inited, {
  sources: { fixture: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
})`
    const installed = await (await fetch(`${origin}/api/v1/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: sourceScript }),
    })).json() as { data: { id: string } }
    expect((await fetch(`${origin}/api/v1/sources/active`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: installed.data.id }),
    })).status).toBe(200)
    expect((await fetch(`${origin}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'common.isAgreePact': true,
        'common.langId': 'zh-cn',
        'common.isShowAnimation': false,
        'common.randomAnimate': false,
        'download.isEmbedPic': false,
        'download.isEmbedLyric': false,
        'download.isDownloadLrc': false,
      }),
    })).status).toBe(200)
    const created = await (await fetch(`${origin}/api/v1/downloads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicInfo: {
          id: 'web-only-completed',
          name: '已完成下载',
          singer: '测试歌手',
          source: 'fixture',
          interval: '00:02',
          meta: { songId: 'web-only-completed', albumName: '测试专辑', _qualitys: { '128k': {} } },
        },
        quality: '128k',
      }),
    })).json() as { data: { id: string } }
    await expect.poll(async() => {
      const response = await fetch(`${origin}/api/v1/downloads`)
      const body = await response.json() as { data: Array<{ id: string, status: string }> }
      return body.data.find(item => item.id === created.data.id)?.status
    }, { timeout: 15_000 }).toBe('completed')

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    try {
      await page.goto(origin, { waitUntil: 'networkidle' })

      await page.getByRole('tab', { name: '设置', exact: true }).click()
      await expect(page.getByRole('tab', { name: '备份与恢复' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '桌面歌词设置' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '数据同步' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '开放 API' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '软件更新' })).toHaveCount(0)
      await page.getByRole('tab', { name: '下载设置' }).click()
      await expect(page.getByText('下载路径', { exact: true })).toHaveCount(0)

      await page.getByTestId('settings-tab-SettingBasic').click()
      await page.getByRole('button', { name: '自定义源管理' }).click()
      await expect(page.getByRole('button', { name: '在线导入' })).toHaveCount(1)
      await page.getByTestId('modal').locator('header button').click()

      await page.getByRole('tab', { name: '我的列表', exact: true }).click()
      await page.getByText('试听列表', { exact: true }).click({ button: 'right' })
      await expect(page.getByRole('tab', { name: '添加本地歌曲' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '导入', exact: true })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '导出', exact: true })).toHaveCount(0)

      await page.goto(`${origin}/#/download`, { waitUntil: 'networkidle' })
      const completedDownload = page.getByText('已完成下载 - 测试歌手', { exact: true })
      await completedDownload.waitFor({ state: 'visible' })
      await completedDownload.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " list-item ")]').click({ button: 'right' })
      await expect(page.getByRole('tab', { name: '定位文件' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '播放', exact: true })).toHaveCount(1)
      await expect(page.getByRole('tab', { name: '移除', exact: true })).toHaveCount(1)
    } finally {
      await context.close()
    }
  } finally {
    await stopService(service)
    await close(audioServer)
    rmSync(root, { recursive: true, force: true })
  }
})
