// Actual Web bundle acceptance with isolated browser storage and in-memory API responses.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const repo = path.resolve(__dirname, '../../..')
process.env.Q_UI_WEB_ROOT ||= path.join(repo, 'apps/player/dist/web-client')
const { createFixture, settings } = require('./verify-cover-first-ui.cjs')
const proof = path.join(repo, '.work/tuneflow-workspace-implementation/verification')
fs.mkdirSync(proof, { recursive: true })
async function main() {
  const fixture = await createFixture()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width:1440, height:900 }, locale:'zh-CN', reducedMotion:'reduce', serviceWorkers:'block' })
  const tasks = fixture.tracks.slice(0,5).map((musicInfo,i)=>({ id:`task_${i}`, musicInfo, status:['running','waiting','paused','error','completed'][i], quality:'128k', progress:[64,0,38,0,100][i], error:i===3?'音源暂不可用，请重试':undefined }))
  let state = 'full'
  const calls = [], errors = [], external = []
  const serviceSettings = { 'download.enable':true, 'download.maxDownloadNum':2, 'download.savePath':'/music', 'download.skipExistFile':true, 'download.isDownloadLrc':true }
  const playlists = [{ id:'ui_playlist', name:'城市漫游', img:`${fixture.origin}/__ui/cover/4.jpg` },{ id:'ui_other', name:'午后晴空',img:`${fixture.origin}/__ui/cover/1.jpg` }]
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), key = url.pathname.slice('/api/v1/'.length)
    if (url.origin !== fixture.origin && /^https?:$/.test(url.protocol)) { external.push(url.origin+url.pathname); return route.abort() }
    if (!url.pathname.startsWith('/api/v1/')) return fixture.handleRoute(route)
    const body = req.postDataJSON() || {}
    calls.push({ key, method:req.method(), body })
    let data
    if (key === 'downloads') {
      if (state === 'loading') await new Promise(resolve=>setTimeout(resolve,4000))
      if (state === 'error') return route.fulfill({status:503,json:{error:{code:'UI_FIXTURE_ERROR'}}})
      data = state === 'empty' ? [] : tasks
    } else if (/^downloads\//.test(key)) {
      const [,id,action] = key.split('/')
      const task = tasks.find(t=>t.id===id)
      if (req.method()==='DELETE') tasks.splice(tasks.indexOf(task),1)
      else task.status = action==='pause'?'paused':'running'
      data = task || {}
    } else if (key==='settings') { if (req.method()==='PATCH') Object.assign(serviceSettings,body); data=serviceSettings }
    else if (key==='playlists') {
      if(req.method()==='POST') playlists.push(...body.playlists)
      data=playlists
    } else if (/^playlists\//.test(key)) data={...playlists.find(p=>p.id===key.split('/')[1]),tracks:fixture.tracks}
    else return fixture.handleRoute(route)
    return route.fulfill({json:{data}})
  })
  await context.addInitScript(({origin,settings})=>{
    localStorage.setItem('qmusic.web.v1.settings',JSON.stringify(settings))
    localStorage.setItem('qmusic.docker.endpoint.v1',origin)
    localStorage.setItem('qmusic.service.daily.mode.v1','server')
  },{origin:fixture.origin,settings})
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message))
  const open=async hash=>{
    if (page.url()==='about:blank') await page.goto(fixture.origin)
    else await page.locator('[data-nav-name="Search"]').click()
    await page.locator('.tf-home section[role="button"]').waitFor()
    await page.evaluate(hash=>{location.hash=hash},hash)
  }
  const shot=async name=>{
    const read=()=>page.evaluate(()=>[document.documentElement,document.querySelector('.tf-app'),document.querySelector('#toolbar'),document.querySelector('.tf-workspace-heading h1')].filter(Boolean).map(el=>({tag:el.tagName,ink:getComputedStyle(el).getPropertyValue('--tf-ink'),paper:getComputedStyle(el).getPropertyValue('--tf-paper'),color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})))
    const before=await read(); await page.waitForTimeout(250); const after=await read()
    fs.writeFileSync(path.join(proof,name+'-colors.json'),JSON.stringify({before,after},null,2))
    await page.screenshot({path:path.join(proof,name+'.png')})
  }
  const theme=async mode=>{ await page.evaluate(mode=>window.lxData.updateSetting({'theme.appearance':mode}),mode); await page.waitForFunction(mode=>getComputedStyle(document.documentElement).getPropertyValue('--tf-color-scheme').trim()===mode,mode) }
  const layout=async label=>{
    const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1, content:[...document.querySelectorAll('.tf-workspace-heading,#setting-panel,.tf-library-detail,.tf-downloads')].filter(el=>el.getBoundingClientRect().width).map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))}))
    assert.equal(result.overflow,false,label)
    for(const {name,rect} of result.content) { assert.ok(rect.width>0 && rect.right<=await page.evaluate(()=>innerWidth)+1,`${label}/${name}: bounds`); assert.ok(rect.bottom<=await page.evaluate(()=>document.getElementById('player').getBoundingClientRect().top)+2,`${label}/${name}: footer overlap`) }
  }
  try {
    for(const mode of ['light','dark']) {
      await open('/setting?name=SettingBasic'); await page.locator('.tf-web-preferences h2').waitFor(); await theme(mode)
      await shot(`settings-${mode}`)
      await page.getByRole('button',{name:mode==='light'?'深色':'浅色',exact:true}).click(); await theme(mode)
      await page.getByRole('tab',{name:'播放设置',exact:true}).click(); await page.locator('#setting-panel select[aria-label="播放音质"]').selectOption('320k')
      await shot(`settings-playback-${mode}`)
      await page.getByRole('tab',{name:'下载设置',exact:true}).click(); await page.locator('.tf-service-settings input[type=number]').waitFor()
      await shot(`settings-download-${mode}`)
      for(const width of [1440,1280,1024,768,640]) { await page.setViewportSize({width,height:900}); await layout(`settings/${mode}/${width}`) }
      await page.setViewportSize({width:1440,height:900})
      await open('/download'); await page.locator('.tf-downloads article').first().waitFor(); await theme(mode); await shot(`downloads-${mode}`)
      for(const width of [1440,1280,1024,768,640]) { await page.setViewportSize({width,height:900}); await layout(`downloads/${mode}/${width}`) }
      await page.setViewportSize({width:1440,height:900})
      await open('/list?id=ui_playlist'); await page.locator('.tf-library-detail .list-item').first().waitFor(); await theme(mode); await shot(`library-${mode}`)
      for(const width of [1440,1280,1024,768,640]) { await page.setViewportSize({width,height:900}); await layout(`library/${mode}/${width}`) }
      await page.setViewportSize({width:1440,height:900})
    }
    await page.locator('.tf-my-lists [data-list-id=ui_other]').click(); await page.locator('.tf-library-detail h2').filter({hasText:'午后晴空'}).waitFor()
    await page.locator('.tf-workspace-heading').getByRole('button',{name:'新建列表',exact:true}).click()
    await page.locator('.tf-my-lists input').last().fill('验收收藏'); await page.locator('.tf-my-lists input').last().press('Enter')
    await page.waitForFunction(()=>document.querySelector('.tf-my-lists').textContent.includes('验收收藏'))
    assert.ok(calls.some(c=>c.key==='playlists'&&c.method==='POST'),'create list uses existing action')
    await open('/download'); await page.locator('.tf-downloads article').first().waitFor()
    await page.locator('.tf-downloads article').first().getByRole('button',{name:'暂停',exact:true}).click()
    await page.locator('.tf-downloads article').first().getByRole('button',{name:'继续',exact:true}).waitFor()
    await page.locator('.tf-downloads article').filter({hasText:'音源暂不可用'}).getByRole('button',{name:'重试',exact:true}).click()
    assert.ok(calls.some(c=>c.key==='downloads/task_3/resume'))
    await page.getByRole('link',{name:'下载设置',exact:true}).click(); await page.getByRole('tab',{name:'下载设置',exact:true,selected:true}).waitFor()
    for (const current of ['empty','error','loading']) {
      state=current; await open('/download'); await page.waitForTimeout(current==='loading'?200:800); await shot(`downloads-${current}`)
      await page.locator('.tf-downloads').getByText(current==='empty'?'暂无下载任务':current==='loading'?'正在加载任务…':'暂时无法加载任务，请刷新重试',{exact:true}).waitFor()
    }
    assert.deepEqual(errors,[]); assert.deepEqual(external,[])
    const report={passed:true,themes:['light','dark'],screens:['settings','settings-playback','settings-download','downloads','library'],widths:[1440,1280,1024,768,640],states:['full','loading','empty','error'],interactions:['appearance mode','playback quality','settings tabs','collection selection','create list','pause task','retry task','download settings link'],rendererErrors:errors,externalRequests:external,serviceStarted:false}
    fs.writeFileSync(path.join(proof,'web-workspace.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2))
  } catch(e) { await shot('failure'); fs.writeFileSync(path.join(proof,'failure.json'),JSON.stringify({error:e.message,errors,calls,external},null,2)); throw e }
  finally { await browser.close(); await fixture.close() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
