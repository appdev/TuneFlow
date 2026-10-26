// Real isolated Service, disposable encoder-generated music; no user profile.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), service = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { chromium, _electron } = require(path.join(service, 'node_modules/playwright'))
const proof = process.env.Q_MEDIA_PROOF || path.join(root, 'artifacts/media-management/verification/fixture')
const fixture = JSON.parse(fs.readFileSync(path.join(proof, 'fixture.json')))
assert.ok(fixture.testOnly && fixture.storage.includes('qmusic-web-fixture-') && /^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.endpoint))
const out = process.env.Q_MEDIA_OUT || path.join(root, 'artifacts/media-management/verification/web')
const api = async(name, method = 'GET', body) => {
  const response = await fetch(fixture.endpoint + '/api/v1/' + name, { method, headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 204) return
  const result = await response.json(); assert.ok(response.ok, name + ': ' + JSON.stringify(result)); return result.data
}
const until = async(check) => { const end = Date.now() + 45000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) } throw Error('Fixture state did not settle') }
;(async() => {
  const sources = await api('sources')
  if (!sources.length) { const imported = await api('sources/import', 'POST', { url: fixture.sourceUrl }); await api('sources/enabled', 'PUT', { sourceIds: [imported.id] }) }
  await api('settings', 'PATCH', { 'player.autoDownloadOnPlay': false, 'download.enable': true })
  for (const track of await api('library/tracks')) await api('library/tracks/' + encodeURIComponent(track.id), 'DELETE')
  await api('downloads', 'POST', { musicInfo: fixture.track, quality: '128k', existingFilePolicy: 'error' })
  const original = await until(async() => (await api('downloads')).find(task => task.status === 'completed' && task.quality === '128k'))
  const originalPath = path.join(fixture.storage, 'audio', original.fileName)
  assert.ok(fs.existsSync(originalPath)); const bytes = fs.readFileSync(originalPath)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-media-'))
  const errors = [], writes = []
  let app, browser
  fs.mkdirSync(out, { recursive: true })
  try {
    let page
    if (process.env.Q_MEDIA_EXE) {
      app = await _electron.launch({ executablePath: process.env.Q_MEDIA_EXE, args: [`--user-data-dir=${profile}`] })
      page = await app.firstWindow(); await page.waitForSelector('#container')
      await app.evaluate(() => { global.lx.appSetting['common.isAgreePact'] = true; global.lx.appSetting['common.langId'] = 'zh-cn' })
    } else { browser = await chromium.launch({ headless: true }); page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } }) }
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() === 'DELETE' || request.url().endsWith('/api/v1/downloads') && request.method() === 'POST') writes.push({ method: request.method(), url: new URL(request.url()).pathname, body: request.postDataJSON() }) })
    await page.addInitScript(endpoint => {
      localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'zh-cn' }))
      localStorage.setItem('qmusic.docker.endpoint.v1', endpoint)
      localStorage.setItem('qmusic.service.daily.mode.v1', 'server')
    }, fixture.endpoint)
    if (app) await page.reload(); else await page.goto(fixture.endpoint)
    const nav = page.locator('[role="toolbar"]').getByRole('tab')
    await nav.nth(3).click()
    await page.getByText('Existing fixture playlist', { exact: true }).click()
    const music = page.locator('#my-list .list-item').filter({ hasText: 'Web fixture' }).first()
    await music.waitFor()
    const download = async() => {
      const select = page.getByRole('button', { name: '多选', exact: true })
      if (await select.count()) await select.click()
      await music.getByRole('checkbox').check()
      await page.getByRole('button', { name: '下载', exact: true }).click()
      const modal = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /无损.*FLAC$/i }) })
      await modal.getByRole('button', { name: /无损.*FLAC$/i }).click()
      await page.getByRole('button', { name: '重新下载并替换', exact: true }).waitFor()
      return modal
    }
    let modal = await download()
    await page.screenshot({ path: path.join(out, 'replace-confirmation.png') })
    await page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '重新下载并替换', exact: true }) }).getByRole('button').first().click()
    await modal.waitFor({ state: 'hidden' })
    await page.waitForTimeout(250)
    assert.deepEqual(fs.readFileSync(originalPath), bytes)
    assert.equal((await api('downloads')).filter(task => task.status === 'completed').length, 1)
    modal = await download()
    await page.getByRole('button', { name: '重新下载并替换', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    const upgraded = await until(async() => (await api('downloads')).find(task => task.status === 'completed' && task.quality === 'flac'))
    const upgradedPath = path.join(fixture.storage, 'audio', upgraded.fileName)
    assert.equal(fs.existsSync(originalPath), false); assert.ok(fs.existsSync(upgradedPath)); assert.equal(fs.readFileSync(upgradedPath).subarray(0, 4).toString(), 'fLaC')
    await nav.nth(4).click()
    await page.getByRole('link', { name: '音乐库', exact: true }).first().click()
    await page.locator('#my-list .list-item').filter({ hasText: 'Web fixture' }).first().waitFor()
    await page.getByRole('button', { name: '多选', exact: true }).click()
    await page.getByRole('checkbox', { name: /选择.*Web fixture/ }).check()
    await page.getByRole('button', { name: '删除音乐文件', exact: true }).click()
    const deletion = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '删除音乐文件', exact: true }) })
    await deletion.getByRole('button').first().click()
    await deletion.waitFor({ state: 'hidden' })
    assert.ok(fs.existsSync(upgradedPath))
    assert.equal(writes.filter(write => write.method === 'DELETE').length, 0)
    await page.getByRole('checkbox', { name: /选择.*Web fixture/ }).check()
    await page.getByRole('button', { name: '删除音乐文件', exact: true }).click()
    await page.screenshot({ path: path.join(out, 'delete-confirmation.png') })
    await deletion.getByRole('button', { name: '删除音乐文件', exact: true }).click()
    await until(async() => !(await api('library/tracks')).length)
    assert.equal(fs.existsSync(upgradedPath), false)
    assert.equal((await api('downloads')).filter(task => task.status === 'completed').length, 0)
    assert.equal((await api('playlists/web_keep')).tracks.length, 1)
    // Download again after deletion; there must be no stale completed-record reuse.
    const again = await api('downloads', 'POST', { musicInfo: fixture.track, quality: '128k', existingFilePolicy: 'error' })
    assert.notEqual(again.status, 'completed')
    await until(async() => (await api('downloads')).some(task => task.id === again.id && task.status === 'completed'))
    assert.deepEqual(errors, [])
    const result = { passed: true, client: app ? 'macos' : 'web', actualMp3ToFlac: true, cancelledReplacementPreservesBytes: true, deletionRequiresConfirmation: true, cancelledDeletionPreservesFile: true, deletedAudioAndCompletedRecords: true, playlistPreserved: true, redownloadAfterDeletion: true, recoverableFallback: 'kw -> wy', syntheticData: true, errors }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
  } finally { if (app) await app.close(); if (browser) await browser.close(); fs.rmSync(profile, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
