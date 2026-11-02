// Read-only real-Service browser acceptance. No response fixtures or screenshots.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const origin = process.env.TUNEFLOW_LIVE_WEB_ORIGIN || 'http://127.0.0.1:39745'
const output = path.resolve(__dirname, '../../../.work/tuneflow-live-integration')
async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width:1280, height:900 }, locale:'zh-CN', reducedMotion:'reduce', serviceWorkers:'block' })
  // Disposable browser preferences only; never patch Service settings or account data.
  await context.addInitScript(() => localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact':true, 'common.isAutoCheckUpdate':false, 'common.langId':'zh-cn', 'theme.id':'yesplay', 'theme.appearance':'light', 'search.isShowHotSearch':false })))
  const page = await context.newPage()
  const statuses = {}, mutationPaths = [], errors = []
  page.on('pageerror', error => errors.push(error.name))
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/v1/') && !['GET','HEAD'].includes(request.method()) && !pathname.startsWith('/api/v1/catalog/')) mutationPaths.push(pathname.replace(/\/[\w%:-]{24,}/g,'/<id>'))
  })
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname
    if (pathname.startsWith('/api/v1/catalog/') || pathname === '/api/v1/health') statuses[pathname] = response.status()
  })
  const evidence = { transport:'actual HTTP to existing Service through loopback forwarder', fixtureResponses:0, realInstanceMutations:0, uiOrigin:origin, screens:{} }
  try {
    await page.goto(origin, {waitUntil:'domcontentloaded'})
    await page.locator('.tf-home').waitFor()
    const capabilities = await context.request.get(origin + '/api/v1/catalog/capabilities')
    assert.equal(capabilities.status(),200,'Real Service capabilities')
    evidence.screens.home = { rendered:true }
    await page.locator('.tf-source-trigger').click()
    await page.getByRole('option').filter({hasText:'QQ音乐'}).click()
    const search = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/catalog/tracks/search' && r.request().postDataJSON()?.source==='tx', {timeout:45000})
    await page.locator('.tf-search-form input').fill('晴天')
    await page.locator('.tf-search-form input').press('Enter')
    const searchResponse = await search
    const data = (await searchResponse.json()).data
    assert.equal(searchResponse.status(),200,'Real search HTTP status')
    assert.ok(data.list.length>0,'Real search returned tracks')
    await page.locator('#view .list-item').first().waitFor()
    evidence.screens.search = { status:200, returnedTracks:data.list.length, renderedRows:await page.locator('#view .list-item').count() }
    await page.locator('[data-nav-name=SongList]').click()
    const browse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/catalog/playlists/browse' && r.request().postDataJSON()?.source==='tx',{timeout:45000})
    await page.evaluate(()=>{ location.hash='/songList/list?source=tx&sortId=5&tagId=&page=1' })
    const browseResponse = await browse
    const browseData = await browseResponse.json()
    evidence.screens.playlists = { status:browseResponse.status(), returnedLists:browseData.data?.list?.length || 0, errorCode:browseData.error?.code }
    assert.equal(browseResponse.status(),200,'Real playlist browse status')
    const boards = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/catalog/leaderboards' && r.request().postDataJSON()?.source==='tx',{timeout:45000})
    await page.locator('[data-nav-name=Leaderboard]').click()
    await page.evaluate(()=>{ location.hash='/leaderboard?source=tx' })
    const boardResponse = await boards
    assert.equal(boardResponse.status(),200)
    await page.locator('.tf-leaderboard .list-item').first().waitFor({timeout:45000})
    evidence.screens.leaderboard = { status:200, returnedBoards:(await boardResponse.json()).data.list.length, renderedRows:await page.locator('.tf-leaderboard .list-item').count() }
    await page.locator('[data-nav-name=List]').click()
    await page.locator('#my-list').waitFor()
    evidence.screens.library = { rendered:true }
    const downloads = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/downloads',{timeout:15000})
    await page.locator('[data-nav-name=Download]').click()
    const downloadResponse = await downloads
    assert.equal(downloadResponse.status(),200)
    evidence.screens.downloads = { status:200, taskCount:(await downloadResponse.json()).data.length }
    await page.locator('[data-nav-name=Setting]').click()
    await page.locator('#SettingBasic-tab').click()
    await page.locator('.tf-web-preferences').waitFor()
    evidence.screens.settings = { rendered:true }
    assert.deepEqual(errors,[],'No renderer errors')
    assert.deepEqual(mutationPaths,[],'No real data mutations during read acceptance')
    evidence.passed = true
  } catch(error) { evidence.passed=false; evidence.failure=error.message.split('\n')[0]; throw error }
  finally {
    fs.mkdirSync(output,{recursive:true})
    fs.writeFileSync(path.join(output,'live-web.json'),JSON.stringify({...evidence,statuses,rendererErrors:errors,mutationPaths},null,2))
    console.log(JSON.stringify(evidence,null,2))
    await browser.close()
  }
}
main().catch(error=>{ console.error(error.message); process.exitCode=1 })
