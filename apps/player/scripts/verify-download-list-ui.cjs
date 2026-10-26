// Disposable UI fixtures only; never reads or changes a real account or download.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { chromium, _electron } = require(path.join(serviceRoot, 'node_modules/playwright'))
const out = process.env.Q_DOWNLOAD_OUT || path.join(root, 'artifacts/download-list/verification/web')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-download-list-'))
const statuses = ['running', 'waiting', 'paused', 'error', 'completed']
let tasks = Array.from({ length: 1500 }, (_, index) => ({
  id: `task-${index}`, status: statuses[index % 5], progress: index === 0 ? 46 : index % 101, quality: '128k',
  error: index % 5 === 3 ? '暂时无法获取歌曲，请稍后重试' : undefined,
  musicInfo: { id: `song-${index}`, source: ['tx', 'wy', 'kg'][index % 3], name: index === 1 ? '一首很长很长的示例歌曲名称，用于验证文字省略和操作对齐' : `示例歌曲 ${index + 1}`, singer: `示例艺术家 ${index + 1}`, meta: { albumName: index === 2 ? '一张很长很长的专辑名称，用于验证列表排版' : '示例专辑' } },
}))
const actions = [], errors = [], layouts = []
;(async() => {
  fs.mkdirSync(out, { recursive: true })
  let browser, app, page
  try {
    if (process.env.Q_DOWNLOAD_EXE) {
      app = await _electron.launch({ executablePath: process.env.Q_DOWNLOAD_EXE, args: [`--user-data-dir=${profile}`] })
      page = await app.firstWindow(); await page.waitForSelector('#container')
      await app.evaluate(() => { global.lx.appSetting['common.isAgreePact'] = true; global.lx.appSetting['common.langId'] = 'zh-cn' })
    } else {
      browser = await chromium.launch({ headless: true })
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    }
    const context = page.context()
    await context.route('**/api/v1/**', async route => {
      const name = new URL(route.request().url()).pathname.replace('/api/v1/', '')
      let data = []
      const match = name.match(/^downloads\/(task-\d+)(?:\/(pause|resume))?$/)
      if (name === 'health') data = { status: 'ok' }
      else if (name === 'catalog/capabilities') data = { sources: [] }
      else if (name === 'settings') data = {}
      else if (name === 'events/snapshot') data = { sequence: 1, events: [] }
      else if (name === 'downloads') data = tasks
      else if (match) {
        const task = tasks.find(task => task.id === match[1])
        actions.push({ id: match[1], action: match[2] || route.request().method() })
        if (match[2]) task.status = match[2] === 'pause' ? 'paused' : 'running'
        else if (route.request().method() === 'DELETE') tasks = tasks.filter(task => task.id !== match[1])
        data = task
      } else if (name.startsWith('playlists/')) data = { tracks: [] }
      else if (name === 'recommendations/daily') data = { status: 'ready', items: [] }
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) }).catch(() => {})
    })
    await page.addInitScript(() => {
      localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'zh-cn' }))
      localStorage.setItem('qmusic.docker.endpoint.v1', location.protocol.startsWith('http') ? location.origin : 'http://127.0.0.1:43999')
      localStorage.setItem('qmusic.service.daily.mode.v1', 'server')
    })
    page.on('pageerror', error => errors.push(error.message))
    if (app) await page.reload()
    else await page.goto(process.env.Q_DOWNLOAD_URL || 'http://127.0.0.1:58928')
    const nav = page.locator('[role="toolbar"]').getByRole('tab')
    await nav.nth(4).click()
    const rows = page.locator('#view article')
    const row = id => rows.filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^示例歌曲 ${id}$`) }) })
    await row(1).waitFor()
    await page.getByText('共 1500 个任务', { exact: true }).waitFor()
    for (const status of ['下载中', '排队中', '已暂停', '失败', '已完成']) assert.ok((await rows.allTextContents()).join(' ').includes(status))
    assert.equal(await row(1).getByRole('progressbar').getAttribute('aria-valuenow'), '46')
    const measure = async label => {
      const value = await rows.evaluateAll(rows => rows.map(row => {
        const rect = row.getBoundingClientRect()
        return { width: rect.width, height: rect.height, overflow: row.scrollWidth > row.clientWidth + 1, outside: [...row.querySelectorAll('button, a')].some(button => { const b = button.getBoundingClientRect(); return b.right > rect.right + 1 || b.left < rect.left - 1 || b.bottom > rect.bottom + 1 }) }
      }))
      assert.ok(value.length > 4 && value.length < 30, 'Virtual list renders only visible rows')
      assert.ok(value.every(row => !row.overflow && !row.outside), JSON.stringify({ label, value }))
      layouts.push({ label, rows: value.length, width: value[0].width, height: value[0].height })
      await page.screenshot({ path: path.join(out, label + '.png') })
    }
    if (app) await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 1000) })
    await page.waitForTimeout(150)
    await measure('wide')
    if (!app) {
      await nav.nth(5).click()
      await page.locator('#SettingBasic-tab').click()
      await page.getByLabel('主题', { exact: true }).selectOption('black')
      await nav.nth(4).click()
      await page.waitForTimeout(150)
      await measure('dark')
    }
    for (const width of [1114, 800]) {
      if (app) await app.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 850) }, width)
      else await page.setViewportSize({ width, height: 850 })
      await page.waitForTimeout(150); await measure('width-' + width)
    }
    await row(1).getByRole('button', { name: '暂停', exact: true }).click()
    await row(1).getByRole('button', { name: '继续', exact: true }).click()
    await row(4).getByRole('button', { name: '重试', exact: true }).click()
    await row(4).getByRole('button', { name: '暂停', exact: true }).waitFor()
    await row(5).getByRole('link', { name: '音乐库', exact: true }).click()
    await page.waitForURL(/list\?id=/)
    await nav.nth(4).click()
    await row(1).getByRole('button', { name: /^移除任务记录：/ }).click()
    await page.getByRole('dialog').getByRole('button').last().click()
    await page.getByText('共 1499 个任务', { exact: true }).waitFor()
    await rows.first().evaluate(row => { const list = row.closest('.scroll'); list.scrollTop = list.scrollHeight })
    await page.getByText('示例歌曲 1500', { exact: true }).waitFor()
    const visibleRows = await rows.count()
    assert.ok(visibleRows < 30)
    await nav.nth(5).click(); await nav.nth(4).click()
    await page.getByText('示例歌曲 1500', { exact: true }).waitFor()
    tasks = []
    await page.getByRole('button', { name: '刷新任务', exact: true }).click()
    await page.getByText('暂无下载任务', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(out, 'empty.png') })
    assert.deepEqual(actions.map(action => action.action), ['pause', 'resume', 'resume', 'DELETE'])
    assert.deepEqual(errors, [])
    const result = { passed: true, client: app ? 'macos' : 'web', layouts, taskCount: 1500, visibleRows, pauseResumeRetry: true, libraryNavigation: true, recordRemoval: true, scrollPositionRetained: true, emptyState: true, syntheticData: true, errors }
    fs.writeFileSync(path.join(out, 'download-ui.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally {
    if (app) await app.close()
    if (browser) await browser.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
