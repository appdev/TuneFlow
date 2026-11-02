// UI acceptance only. Every API request is fulfilled in memory; no Service runs.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '../..')
const output = process.env.Q_UI_WEB_ROOT || path.join(root, 'dist/web-client')
const proof = path.join(repo, '.work/tuneflow-ui-implementation/verification')
// Synthetic artwork makes acceptance checks portable and independent of downloads.
const cover = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#335eea"/><circle cx="160" cy="160" r="86" fill="#bbcdff"/></svg>')
fs.mkdirSync(proof, { recursive: true })
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const picture = /^\/__ui\/cover\/(\d+)\.jpg$/.exec(url.pathname)
  if (picture) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(cover); return }
  const file = path.resolve(output, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
  if ((!picture && !file.startsWith(output + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
  res.end(fs.readFileSync(file))
})
const listen = () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const profile = () => ({ state: 'disconnected', displayName: '', avatar: '', accountHint: '', hasSession: false })
const account = { tx: false, wy: false, kg: false, serverId: 'ui-fixture-only', revision: 1, revisions: { tx: 0, wy: 0, kg: 0 }, accounts: { tx: profile(), wy: profile(), kg: profile() } }
const settings = { 'common.isAgreePact': true, 'common.isAutoCheckUpdate': false, 'common.langId': 'zh-cn', 'common.fontSize': 16, 'theme.id': 'green', 'theme.appearance': 'light', 'desktopLyric.enable': false, 'playDetail.style.layout': 'immersive', 'search.isShowHotSearch': false }
async function createFixture() {
  const origin = await listen()
  const tracks = Array.from({ length: 9 }, (_, i) => ({ id: `ui_${i}`, source: ['tx', 'wy', 'kg'][i % 3], name: ['晨光序曲', '城市漫游', '午后晴空', '沿着海岸线', '冬日来信', '星河旅人'][i % 6], singer: i % 2 ? '云间音乐室' : '音流示例乐队', interval: '03:42', meta: { songId: `ui_${i}`, albumName: '界面验收示例', picUrl: `${origin}/__ui/cover/${i}.jpg`, qualitys: [{ type: '128k', size: null }], _qualitys: { '128k': { size: null } } } }))
  const collection = { id: 'ui_playlist', name: '城市漫游', author: '云间音乐室', description: '沿着街道慢慢走，让音乐陪你穿过城市的日常。', img: `${origin}/__ui/cover/4.jpg`, total: tracks.length }
  const calls = [], blocked = [], errors = [], unexpected = []
  let feedState = 'full'
  const handleRoute = async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!/^https?:$/.test(url.protocol)) return route.continue()
    if (!url.pathname.startsWith('/api/v1/')) {
      if (url.origin === origin) return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    }
    const key = url.pathname.slice('/api/v1/'.length)
    calls.push({ path: url.pathname, method: request.method() })
    const body = request.postDataJSON() || {}
    let data
    if (key === 'health') data = { status: 'ok' }
    else if (key === 'catalog/capabilities') data = { sources: ['tx', 'wy', 'kg', 'kw', 'mg'].map(id => ({ id, name: id })) }
    else if (key === 'events/snapshot') data = { sequence: 0, events: [] }
    else if (key === 'settings') data = { 'download.enable': true }
    else if (key === 'accounts/status') data = account
    else if (/accounts\/\w+\/daily/.test(key)) data = { list: [], status: 'login_required' }
    else if (/accounts\/\w+\/playlists/.test(key)) data = { provider: 'tx', status: 'login_required', playlists: [], revision: 0 }
    else if (key === 'playlists') data = [collection]
    else if (key.startsWith('playlists/')) data = { ...collection, tracks: key.includes('default') || key.includes('love') ? [] : tracks }
    else if (key === 'library/tracks' || key === 'playback/history' || key === 'sources' || key === 'downloads') data = []
    else if (key === 'recommendations/daily') {
      if (feedState === 'loading') await new Promise(resolve => setTimeout(resolve, 6000))
      if (feedState === 'error') return route.fulfill({ status: 503, json: { error: { code: 'UI_FIXTURE_ERROR' } } })
      data = { status: 'ready', version: 1, items: (feedState === 'empty' ? [] : tracks).map((track, i) => ({ track, recommendationItemId: `ui_recommendation_${i}` })) }
    } else if (key === 'catalog/tracks/picture') data = { url: body.musicInfo?.meta?.picUrl || `${origin}/__ui/cover/0.jpg` }
    else if (key === 'catalog/playlists/tags') data = { groups: [], hotTags: [], sorts: [{ id: 'hot', name: '推荐' }] }
    else if (key === 'catalog/playlists/browse') data = { list: [collection], total: 1, page: 1, limit: 30, hasMore: false }
    else if (key === 'catalog/playlists/detail') data = { list: [], playlist: collection, tracks, total: tracks.length, page: 1, limit: 30, hasMore: false }
    else if (/catalog\/(tracks|playlists|albums)\/search/.test(key)) data = { list: key.includes('tracks') ? tracks : [collection], total: tracks.length, page: 1, limit: 30, hasMore: false }
    else if (key === 'catalog/leaderboards') data = { list: [{ id: 'ui_board', providerId: 'ui_board', name: '音乐榜示例' }] }
    else if (key === 'catalog/leaderboards/tracks') data = { list: tracks, total: 9, page: 1, limit: 30 }
    else if (key.startsWith('catalog/tracks/lyrics')) data = { lyric: '' }
    else { unexpected.push(key); data = [] }
    await route.fulfill({ json: { data } })
  }
  return { origin, tracks, calls, blocked, errors, unexpected, handleRoute, setFeedState: value => { feedState = value }, close: async() => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
async function main() {
  const fixture = await createFixture()
  const { origin, calls, blocked, errors, unexpected } = fixture
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await context.route('**/*', fixture.handleRoute)
  await context.addInitScript(({ settings, origin }) => {
    localStorage.setItem('qmusic.web.v1.settings', JSON.stringify(settings))
    localStorage.setItem('qmusic.docker.endpoint.v1', origin)
    localStorage.setItem('qmusic.service.daily.mode.v1', 'server')
  }, { settings, origin })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('.tf-home section[role="button"]').waitFor()
    await page.locator('.tf-home img').first().waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.tf-home img').length >= 9)
    const screenshot = name => page.screenshot({ path: path.join(proof, name + '.png') })
    const theme = async mode => {
      await page.evaluate(mode => window.lxData.updateSetting({ 'theme.appearance': mode }), mode)
      await page.waitForFunction(mode => getComputedStyle(document.documentElement).getPropertyValue('--tf-color-scheme').trim() === mode, mode)
    }
    const checkLayout = async(label, width) => {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(80)
      const layout = await page.evaluate(() => {
        const rect = el => el.getBoundingClientRect().toJSON()
        const header = document.getElementById('toolbar')
        const children = [...header.children].filter(el => el.getBoundingClientRect().width && getComputedStyle(el).position !== 'absolute')
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, header: children.map(rect), footer: rect(document.querySelector('.q-player-footer')), regions: [...document.querySelector('.q-player-footer').children].map(rect) }
      })
      assert.ok(layout.scroll <= width + 1, `${label}/${width}: horizontal overflow`)
      for (const rect of layout.header) assert.ok(rect.x >= -1 && rect.right <= width + 1, `${label}/${width}: header control offscreen`)
      for (let i = 1; i < layout.header.length; i++) {
        const a = layout.header[i - 1], b = layout.header[i]
        assert.ok(a.right <= b.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `${label}/${width}: header controls overlap`)
      }
      for (const rect of layout.regions) assert.ok(rect.x >= -1 && rect.right <= width + 1 && rect.bottom <= 901, `${label}/${width}: footer region offscreen`)
    }
    const nativeTabs = page.locator('[data-tf-navigation] [role="tab"]')
    assert.equal(await nativeTabs.count(), 6, 'All existing destinations remain available')
    for (const mode of ['light', 'dark']) {
      await theme(mode)
      for (const width of [1920, 1440, 1280, 1024, 768, 640]) await checkLayout(`home/${mode}`, width)
      await page.setViewportSize({ width: 1440, height: 900 })
      await screenshot(`web-home-${mode}`)
      await page.locator('.tf-home section[role="button"]').click()
      await page.locator('.tf-playlist-detail ol.scroll > li').first().waitFor()
      for (const width of [1440, 1024, 768]) await checkLayout(`playlist/${mode}`, width)
      await page.setViewportSize({ width: 1440, height: 900 })
      await screenshot(`web-playlist-${mode}`)
      await page.locator('.tf-playlist-detail > header > button').first().click()
    }
    await page.getByRole('button', { name: '外观模式', exact: true }).click()
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--tf-color-scheme').trim() === 'light')
    await page.locator('.tf-search-slot input').fill('晨光')
    await page.locator('.tf-search-slot input').press('Enter')
    await page.waitForURL(/text=/)
    await page.locator('[data-nav-name="SongList"]').click()
    await page.waitForURL(/songList\/list/)
    for (const width of [1440, 1024, 768, 640]) await checkLayout('resume-search', width)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => { location.hash = '/songList/detail?source=tx&id=ui_playlist&page=1' })
    await page.locator('#view h3').filter({ hasText: '城市漫游' }).first().waitFor()
    for (const mode of ['light', 'dark']) { await theme(mode); await screenshot(`web-online-playlist-${mode}`) }
    await theme('light')
    await page.locator('[data-nav-name="Leaderboard"]').click()
    await page.waitForURL(/leaderboard/)
    await page.locator('[data-nav-name="List"]').click()
    await page.waitForURL(/#\/list/)
    await page.locator('[data-nav-name="Download"]').click()
    await page.waitForURL(/download/)
    await page.locator('[data-nav-name="Setting"]').click()
    await page.waitForURL(/setting/)
    await page.locator('[data-nav-name="Search"]').click()
    await page.waitForURL(/search/)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.font': 'monospace' }))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.tf-app')).fontFamily.includes('monospace'))
    await page.evaluate(() => window.lxData.updateSetting({ 'common.font': '' }))
    await page.waitForFunction(() => !getComputedStyle(document.querySelector('.tf-app')).fontFamily.includes('monospace'))
    await page.evaluate(origin => {
      Object.assign(window.lxData.musicInfo, { id: 'ui_display_track', name: '晨光序曲', singer: '音流示例乐队', album: '界面验收示例', pic: `${origin}/__ui/cover/3.jpg`, lrc: '[00:00.00]走过清晨的街道\n[00:10.00]听见风吹过树梢\n[00:20.00]把今天，慢慢听完。\n[00:30.00]让旋律在此刻停留\n[00:40.00]再向下一个路口出发' })
      window.app_event.lyricUpdated()
    }, origin)
    for (const mode of ['light', 'dark']) {
      await theme(mode)
      await page.locator('.q-player-footer button').first().click()
      await page.locator('.q-player-detail').waitFor()
      await page.locator('.q-player-detail .line-content').first().waitFor()
      for (const width of [1920, 1440, 1280, 1024, 768]) await checkLayout(`player/${mode}`, width)
      await page.setViewportSize({ width: 1440, height: 900 })
      await screenshot(`web-player-${mode}`)
      await page.locator('.q-player-detail > button').first().click()
    }
    for (const state of ['empty', 'error', 'loading']) {
      fixture.setFeedState(state)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.tf-home section[role="button"]').waitFor()
      await page.waitForTimeout(state === 'loading' ? 250 : 800)
      await screenshot(`web-home-${state}`)
    }
    assert.deepEqual(errors, [], 'No renderer errors')
    assert.deepEqual(blocked, [], 'No attempt to use real upstreams')
    const evidence = { passed: true, transport: 'browser interception only', serviceStarted: false, realUpstreamRequests: 0, themes: ['light', 'dark'], screens: ['home', 'daily-playlist', 'online-playlist', 'player'], allNavigationDestinations: 6, preservedSearchAndResume: true, customFontPreserved: true, widths: [1920, 1440, 1280, 1024, 768, 640], states: ['empty', 'error', 'loading'], requestsFulfilled: calls.length, unexpectedFixtureRoutes: [...new Set(unexpected)], rendererErrors: errors }
    fs.writeFileSync(path.join(proof, 'web-ui.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence, null, 2))
  } catch (error) {
    await page.screenshot({ path: path.join(proof, 'web-failure.png') })
    fs.writeFileSync(path.join(proof, 'failure.json'), JSON.stringify({ message: error.message, errors, calls, blocked, unexpected }, null, 2))
    throw error
  } finally { await browser.close(); await fixture.close() }
}
module.exports = { createFixture, settings, account, proof }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
