// Actual playback against the disposable Service fixture, never production data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { chromium, _electron } = require(path.join(serviceRoot, 'node_modules/playwright'))
const proof = process.env.Q_WEB_PROOF || path.join(root, 'artifacts/auto-download/verification')
const fixture = JSON.parse(fs.readFileSync(path.join(proof, 'fixture.json')))
assert.ok(fixture.testOnly && /^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.endpoint), 'Disposable loopback fixture required')
const executablePath = process.env.Q_AUTO_EXE
const api = async(route, method = 'GET', body) => {
  const response = await fetch(fixture.endpoint + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 204) return
  const value = await response.json()
  assert.ok(response.ok, route + ': ' + JSON.stringify(value))
  return value.data
}
const until = async(check) => {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Automatic download state did not settle')
}
;(async() => {
  assert.deepEqual(await api('downloads'), [], 'Use a fresh fixture for each UI run')
  const source = await api('sources', 'POST', { script: fs.readFileSync(fixture.sourcePath, 'utf8') })
  await api('sources/enabled', 'PUT', { sourceIds: [source.id] })
  await api('settings', 'PATCH', { 'download.enable': false })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-auto-ui-'))
  let browser, app, page
  const errors = [], writes = []
  try {
    if (executablePath) {
      app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`] })
      page = await app.firstWindow()
      await page.waitForSelector('#container')
      await app.evaluate(() => { global.lx.appSetting['common.isAgreePact'] = true })
      await page.evaluate(endpoint => { localStorage.setItem('qmusic.docker.endpoint.v1', endpoint) }, fixture.endpoint)
    } else {
      browser = await chromium.launch({ headless: true })
      page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
    }
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/downloads') writes.push(request.url()) })
    await page.addInitScript(() => {
      if (location.protocol.startsWith('http')) localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'zh-cn' }))
      localStorage.setItem('qmusic.service.daily.mode.v1', 'server')
      window.qaAudio = []
      const Original = window.Audio
      window.Audio = function(...args) { const audio = new Original(...args); window.qaAudio.push(audio); return audio }
      window.Audio.prototype = Original.prototype
    })
    if (app) await page.reload()
    else await page.goto(fixture.endpoint)
    const nav = page.locator('[role="toolbar"]')
    const settings = async() => {
      await nav.getByRole('tab').nth(5).click()
      await page.locator('#SettingDownload-tab').click()
      return page.getByLabel('边听边存（播放时自动下载）', { exact: true })
    }
    const toggle = await settings()
    await toggle.waitFor()
    assert.equal(await toggle.isChecked(), false)
    await toggle.check()
    await until(async() => (await api('settings'))['player.autoDownloadOnPlay'] === true)
    await page.reload()
    assert.equal(await (await settings()).isChecked(), true, 'Shared switch survives reload')
    assert.equal((await api('settings'))['download.enable'], false)
    assert.deepEqual(await api('downloads'), [], 'Enabling alone does not download')
    console.log('PASS shared switch persists; enabling alone does not download')
    await nav.getByRole('tab').nth(3).click()
    await page.getByText('Existing fixture playlist', { exact: true }).click()
    await page.getByRole('button', { name: '播放全部', exact: true }).click()
    await page.waitForFunction(() => window.qaAudio.some(audio => !audio.paused && audio.currentTime > 0.2 && audio.currentSrc.includes('/api/v1/streams/')))
    const job = await until(async() => {
      const current = (await api('downloads'))[0]
      assert.notEqual(current?.status, 'error', current?.error)
      return current?.status === 'completed' ? current : false
    })
    assert.equal((await api('downloads')).length, 1)
    assert.ok(fs.readdirSync(path.join(fixture.storage, 'audio')).some(name => !name.endsWith('.lrc')))
    assert.ok(JSON.parse(fs.readFileSync(path.join(proof, 'upstream-requests.json'))).includes('/audio-from-wy.mp3'), 'Recoverable failure switches platform')
    console.log('PASS actual playback, automatic file on disk and platform fallback')
    await page.getByRole('button', { name: '播放全部', exact: true }).click()
    await page.waitForTimeout(500)
    assert.equal((await api('downloads')).length, 1, 'Replay reuses the server download')
    await nav.getByRole('tab').nth(4).click()
    await page.getByRole('link', { name: '打开音乐库', exact: true }).click()
    await page.getByRole('button', { name: '播放全部', exact: true }).click()
    await page.waitForFunction(() => window.qaAudio.some(audio => !audio.paused && audio.currentTime > 0.2 && audio.currentSrc.includes('/api/v1/library/tracks/')))
    assert.equal((await api('downloads')).length, 1, 'Library playback does not create another download')
    console.log('PASS replay deduplication and library playback skips')
    await (await settings()).uncheck()
    await until(async() => (await api('settings'))['player.autoDownloadOnPlay'] === false)
    const next = { ...fixture.track, id: 'disabled-save', source: 'wy', name: 'Disabled save fixture', meta: { ...fixture.track.meta, songId: 12345 } }
    await api('playlists', 'POST', { position: 0, playlists: [{ id: 'auto_disabled', name: 'Auto disabled fixture' }] })
    await api('playlists/auto_disabled/tracks', 'POST', { position: 'bottom', tracks: [next] })
    await page.reload()
    await nav.getByRole('tab').nth(3).click()
    await page.getByText('Auto disabled fixture', { exact: true }).click()
    await page.getByRole('button', { name: '播放全部', exact: true }).click()
    await page.waitForFunction(() => window.qaAudio.some(audio => !audio.paused && audio.currentTime > 0.2 && audio.currentSrc.includes('/api/v1/streams/')))
    await until(async() => (await api('playback/history')).some(item => item.track.id === next.id))
    await page.waitForTimeout(500)
    assert.equal((await api('downloads')).length, 1, 'Disabled switch prevents the next online track from downloading')
    assert.deepEqual(writes, [], 'No manual download request was sent')
    assert.deepEqual(errors, [])
    const result = { passed: true, client: app ? 'desktop-macos' : 'web', switchPersists: true, actualPlayback: true, fileOnServer: true, automaticTaskId: job.id, manualDownloadsDisabled: true, replayDeduplicates: true, libraryPlaybackSkips: true, disablingStopsNext: true, platformFallback: 'KW → WY', rendererErrors: errors, isolatedService: true }
    fs.writeFileSync(path.join(proof, 'auto-download-ui.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(proof, 'auto-download-error.png') })
    console.error('Renderer errors:', errors)
    throw error
  } finally {
    if (app) await app.close()
    if (browser) await browser.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
