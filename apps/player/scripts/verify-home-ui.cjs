// Run against a disposable recommendation Service, never a user's Docker data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../../lx-music-server-web')
const { _electron } = require(process.env.Q_PLAYWRIGHT || path.join(serviceRoot, 'node_modules/playwright'))
const endpoint = process.env.Q_HOME_FIXTURE
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint ?? '')) throw Error('Q_HOME_FIXTURE must be a disposable loopback Service')
const proof = path.join(root, 'artifacts/home-recommendations/verification')
fs.mkdirSync(proof, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-home-ui-'))
const executablePath = path.join(root, 'artifacts/home-recommendations/darwin-arm64/mac-arm64/Q-music Docker Preview.app/Contents/MacOS/Q-music Docker Preview')
const read = async() => (await (await fetch(endpoint + '/api/v1/recommendations/daily')).json()).data
const until = async(check) => {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)) }
  throw Error('Timed out waiting for new recommendation generation')
}
;(async() => {
  const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 60000 })
  let page
  try {
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // Each test uses a new profile, including the upstream first-run license.
    await page.getByRole('button', { name: '接受', exact: true }).evaluate(button => button.click())
    await page.evaluate(endpoint => {
      localStorage.setItem('qmusic.docker.endpoint.v1', endpoint)
      localStorage.setItem('qmusic.dailyRecommend.provider', 'tx')
      localStorage.setItem('qmusic.service.daily.mode.v1', 'account')
    }, endpoint)
    await page.reload()
    const card = page.locator('section[role="button"]')
    const grid = page.locator('section:has(> header) > div > button')
    await grid.first().waitFor({ timeout: 45000 })
    assert.equal(await grid.count(), 9)
    assert.equal(await card.locator('> div:first-child > div:not(:last-child)').count(), 4)
    assert.ok((await card.innerText()).includes('账号未登录'))
    await page.screenshot({ path: path.join(proof, 'desktop-home.png') })
    const before = await read()
    const firstName = await grid.first().innerText()
    const refresh = card.locator('button').nth(1)
    await refresh.click()
    // A generation must not hide the previous list while its replacement runs.
    assert.equal(await grid.count(), 9)
    await until(async() => (await read()).version > before.version)
    await until(async() => await grid.first().innerText() !== firstName)
    const after = await read()
    assert.equal(after.items.some(item => before.items.some(old => item.canonicalTrackId === old.canonicalTrackId)), false)
    await card.click()
    const rows = page.locator('ol.scroll > li')
    await rows.first().waitFor()
    assert.equal(await rows.count(), after.items.length)
    const resolves = []
    page.on('request', request => { if (request.url().includes('/api/v1/playback/tracks/resolve')) resolves.push(request.url()) })
    await rows.first().locator('button').click()
    await until(async() => resolves.length > 0)
    await page.screenshot({ path: path.join(proof, 'desktop-detail.png') })
    const evidence = { passed: true, version: await app.evaluate(({ app }) => app.getVersion()), mosaicTiles: 4, discoveryCards: 9, accountFallback: true, replacement: { before: before.version, after: after.version, overlap: 0 }, automaticUpdate: true, detailCount: await rows.count(), dockerResolve: resolves.length > 0, isolatedProfile: true }
    fs.writeFileSync(path.join(proof, 'desktop-ui.json'), JSON.stringify(evidence, null, 2))
    console.log(evidence)
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(proof, 'desktop-debug.png') })
      console.error({ body: (await page.locator('body').innerText()).slice(0, 3500) })
    }
    throw error
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
