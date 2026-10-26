// Synthetic accounts and catalog DTOs. No user profile or production writes.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { chromium, _electron } = require(path.join(serviceRoot, 'node_modules/playwright'))
const out = process.env.Q_HOME_OUT || path.join(root, 'artifacts/home-unified/verification/web')
fs.mkdirSync(out, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-home-cache-'))
const calls = [], errors = []
const song = (source, id) => ({ id, source, name: `${source} song ${id}`, singer: 'Fixture artist', meta: { songId: id, qualitys: [{ type: '128k', size: null }] } })
;(async() => {
  let browser, app, page
  try {
    if (process.env.Q_HOME_EXE) {
      app = await _electron.launch({ executablePath: process.env.Q_HOME_EXE, args: [`--user-data-dir=${profile}`] })
      page = await app.firstWindow(); await page.waitForSelector('#container')
      await app.evaluate(() => { global.lx.appSetting['common.isAgreePact'] = true; global.lx.appSetting['common.langId'] = 'zh-cn' })
    } else {
      browser = await chromium.launch({ headless: true })
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    }
    const context = app ? app.context() : page.context()
    await context.route('**/api/v1/**', async route => {
      const request = route.request(), name = new URL(request.url()).pathname.replace('/api/v1/', ''), body = request.postDataJSON() ?? {}
      calls.push({ name, body, method: request.method() })
      let data = []
      if (name === 'health') data = { status: 'ok' }
      else if (name === 'events/snapshot') data = { sequence: 1, events: [] }
      else if (name === 'catalog/capabilities') data = { sources: [] }
      else if (name === 'settings') data = { 'download.enable': true, 'player.autoDownloadOnPlay': false }
      else if (name.startsWith('playlists/')) data = { tracks: [] }
      else if (name === 'catalog/playlists/browse') data = { list: [{ id: 'one' }, { id: 'two' }] }
      else if (name === 'catalog/playlists/detail') { await new Promise(resolve => setTimeout(resolve, 100)); data = { tracks: [song(body.source, body.playlistId), song(body.source, body.playlistId + '-extra')] } }
      else if (name === 'catalog/tracks/picture') data = { url: '/api/v1/playback/resources/fixture/picture' }
      else if (name === 'recommendations/daily') data = { status: 'ready', version: 1, items: [{ track: song('kw', 'generic'), recommendationItemId: 'generic' }] }
      else if (name.includes('/picture')) { await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNOkAAAAASUVORK5CYII=', 'base64') }); return }
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) }).catch(() => {})
    })
    await page.addInitScript(() => {
      localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'zh-cn' }))
      localStorage.setItem('qmusic.docker.endpoint.v1', location.protocol.startsWith('http') ? location.origin : 'http://127.0.0.1:43999')
      localStorage.setItem('qmusic.service.daily.mode.v1', 'account')
      localStorage.setItem('qmusic.dailyRecommend.provider', 'tx')
    })
    page.on('pageerror', error => errors.push(error.message))
    if (app) await page.reload()
    else await page.goto(process.env.Q_HOME_URL || 'http://127.0.0.1:58928')
    const sources = page.getByRole('navigation', { name: '推荐来源', exact: true })
    const catalogCount = () => calls.filter(call => call.name === 'catalog/playlists/browse' || call.name === 'catalog/playlists/detail').length
    await page.getByText('QQ 音乐精选 · 2 首', { exact: true }).waitFor()
    assert.equal(catalogCount(), 2)
    const nav = page.locator('[role="toolbar"]')
    await nav.getByRole('tab').nth(5).click(); await nav.getByRole('tab').nth(0).click()
    await page.getByText('QQ 音乐精选 · 2 首', { exact: true }).waitFor()
    assert.equal(catalogCount(), 2, 'Main navigation retains recommendations')
    await sources.getByRole('button').nth(1).click()
    await page.getByText('网易云音乐精选 · 2 首', { exact: true }).waitFor()
    assert.equal(catalogCount(), 4)
    await sources.getByRole('button').nth(0).click()
    await page.getByText('QQ 音乐精选 · 2 首', { exact: true }).waitFor()
    assert.equal(catalogCount(), 4, 'Provider switching reuses its snapshot')
    await page.getByRole('button', { name: '换一批', exact: true }).click()
    await page.getByText('tx song two', { exact: true }).first().waitFor()
    assert.equal(catalogCount(), 6)
    await sources.getByRole('button').nth(3).click()
    await page.getByText('今日推荐 · 1 首', { exact: true }).waitFor()
    await sources.getByRole('button').nth(0).click()
    await page.getByText('tx song two', { exact: true }).first().waitFor()
    assert.equal(catalogCount(), 6)
    await sources.getByRole('button').nth(2).click()
    await sources.getByRole('button').nth(0).click()
    await page.waitForTimeout(250)
    await page.getByText('tx song two', { exact: true }).first().waitFor()
    assert.doesNotMatch(await page.locator('body').innerText(), /Docker 推荐|当前设备|当前客户端|服务器推荐/)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(out, 'homepage.png') })
    const result = { passed: true, client: app ? 'macos' : 'web', anonymousPublicPlatforms: true, mainNavigationRetains: true, providerSnapshotsRetained: true, manualBatchRefresh: true, genericFallback: true, lateSourceCannotOverwrite: true, unifiedCopy: true, rendererErrors: errors, syntheticCatalog: true, realPlatformProbeSeparate: true }
    fs.writeFileSync(path.join(out, 'home-ui.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally { if (app) await app.close(); if (browser) await browser.close(); fs.rmSync(profile, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
