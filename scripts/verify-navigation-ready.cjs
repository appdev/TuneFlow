const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../../lx-music-server-web')
const { _electron, chromium } = require(path.join(serviceRoot, 'node_modules/playwright'))
const webUrl = process.env.Q_PERF_WEB_URL
const output = process.env.Q_PERF_OUT || path.join(root, 'artifacts/navigation-round2/verification/native')
const executablePath = process.env.Q_PERF_EXE || path.join(root, 'artifacts/navigation-round2/darwin-arm64/mac-arm64/Q-music Docker Preview.app/Contents/MacOS/Q-music Docker Preview')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-perf2-'))
const delay = Number(process.env.Q_PERF_DELAY || 150)
const tracks = Number(process.env.Q_PERF_TRACKS || 1500)
const downloads = Number(process.env.Q_PERF_DOWNLOADS || 200)
const calls = []
const errors = []
const taskUpdates = new Map()
const song = i => ({ id: `qa_${i}`, source: 'kw', name: `QA song ${i}`, singer: 'QA artist', interval: '03:00', meta: { songId: String(i), albumName: 'QA album', qualitys: [{ type: '128k', size: null }] } })
const trackList = Array.from({length:tracks},(_,i)=>song(i))
const userLists = Array.from({length:8},(_,i)=>({id:`qa_list_${i}`,name:`QA playlist ${i}`,source:'kw'}))
const endpoints = url => {
  const p = new URL(url).pathname.replace('/api/v1/', '')
  if (p === 'health') return {status:'ok'}
  if (p === 'catalog/capabilities') return {sources:['kw','kg','tx','wy','mg'].map(id=>({id,name:id,searchKinds:['tracks','playlists','albums'],leaderboards:true,playlistDiscovery:{browse:true,detail:true}}))}
  if (p === 'events/snapshot') return {sequence:1,events:[]}
  if (p === 'settings') return {'download.maxDownloadNum':2,'download.savePath':'/qa','download.isEmbedPic':false}
  if (p === 'playlists') return userLists
  if (p.startsWith('playlists/')) { const id=p.split('/')[1]; return {id,name:id,tracks:trackList} }
  if (p === 'library/tracks' || p === 'playback/history' || p === 'sources') return []
  if (p === 'downloads') return Array.from({length:downloads},(_,i)=>({id:'task_'+i,status:'completed',quality:'128k',progress:100,musicInfo:song(i),...taskUpdates.get('task_'+i)}))
  if (p === 'recommendations/daily') return {status:'ready',version:1,items:Array.from({length:30},(_,i)=>({track:song(i),recommendationItemId:`r${i}`}))}
  if (p === 'catalog/leaderboards') return {list:[{id:'1',providerId:'1',name:'QA Board'}]}
  if (p.includes('leaderboards/')) return {source:'kw',list:trackList.slice(0,30),total:tracks,page:1,limit:30,hasMore:true}
  if (p.endsWith('/tags')) return {groups:[],hotTags:[],sorts:[{id:'new',name:'New'}]}
  if (p === 'catalog/playlists/browse') return {source:'kw',list:Array.from({length:30},(_,i)=>({id:'col_'+i,name:'QA collection '+i,source:'kw',author:'QA',img:null})),total:30,page:1,limit:30,hasMore:false}
  if (p.includes('picture')) return {url:'/api/v1/playback/resources/qa/picture'}
  return {source:'kw',list:[],total:0,page:1,limit:30,hasMore:false}
}
;(async()=>{
  fs.mkdirSync(output,{recursive:true})
  let app
  if (webUrl) {
    const browser=await chromium.launch({headless:true})
    const context=await browser.newContext({viewport:{width:1114,height:718},locale:'zh-CN'})
    await context.addInitScript(()=>{
      if(!location.protocol.startsWith('http'))return
      localStorage.setItem('qmusic.web.v1.settings',JSON.stringify({'common.isAgreePact':true,'common.langId':'zh-cn'}))
      localStorage.setItem('qmusic.docker.endpoint.v1',location.origin)
      localStorage.setItem('qmusic.service.daily.mode.v1','server')
    })
    const page=await context.newPage()
    app={context:()=>context,firstWindow:async()=>page,close:async()=>browser.close()}
  } else app=await _electron.launch({executablePath,args:[`--user-data-dir=${profile}`],timeout:30000})
  let page
  try {
    await app.context().route('**/api/v1/**',async route=>{
      const req=route.request(), data=endpoints(req.url()), body=JSON.stringify({data})
      const action=new URL(req.url()).pathname.match(/\/downloads\/(task_\d+)\/(pause|resume)$/)
      if(req.method()==='POST'&&action)taskUpdates.set(action[1],{status:action[2]==='pause'?'paused':'running',progress:50})
      const call={path:new URL(req.url()).pathname,method:req.method(),start:Date.now(),bytes:body.length}
      calls.push(call)
      await new Promise(resolve=>setTimeout(resolve,delay))
      await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body}).catch(()=>{})
      call.end=Date.now()
    })
    page=await app.firstWindow()
    page.on('pageerror',e=>errors.push(e.message))
    if(webUrl)await page.goto(webUrl)
    await page.waitForSelector('#container')
    // Test-only onboarding fixture. No real profile or agreement is changed.
    if(!webUrl)await app.evaluate(()=>{global.lx.appSetting['common.isAgreePact']=true})
    await page.evaluate(web=>{localStorage.setItem('qmusic.docker.endpoint.v1',web?location.origin:'http://127.0.0.1:43999');localStorage.setItem('qmusic.service.daily.mode.v1','server')},!!webUrl)
    if (process.env.Q_PERF_RENDERER_ROOT) {
      const entry=require('node:url').pathToFileURL(path.join(process.env.Q_PERF_RENDERER_ROOT,'index.html')).href
      await page.goto(entry+new URL(page.url()).search)
    } else await page.reload()
    await page.waitForFunction(()=>document.querySelector('#view')?.textContent.includes('QA song'),null,{timeout:15000})
    await page.waitForTimeout(1200)
    const cdp=await app.context().newCDPSession(page)
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
    await page.evaluate(()=>{window.qaPerf={long:[]};new PerformanceObserver(list=>window.qaPerf.long.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false})})
    const results=[]
    const measure=async(kind,index,round)=>{
      const firstCall=calls.length
      const value=await page.evaluate(async({kind,index})=>{
        const selector=kind==='main'?'[role="toolbar"] a[role="tab"]':'[aria-label="设置分类"] button[role="tab"]'
        const target=document.querySelectorAll(selector)[index]
        const label=target.getAttribute('aria-label'),start=performance.now()
        target.click()
        const result=await new Promise((resolve,reject)=>{
          let selected,shell
          const frame=()=>{
            const now=performance.now()
            if(now-start>12000){reject(Error('Timeout '+label+': '+document.querySelector('#view')?.textContent.slice(0,450)));return}
            if(target.getAttribute('aria-selected')!=='true'){requestAnimationFrame(frame);return}
            selected??=now-start
            const node=document.querySelector('#view .view-container')
            if(!node||!node.getBoundingClientRect().height){requestAnimationFrame(frame);return}
            shell??=now-start
            const text=node.textContent
            const ready=kind==='setting'?!!document.querySelector('#setting-panel > dl > div'):index===1?text.includes('QA collection'):index===2?text.includes('QA song'):index===3?!!document.querySelector('#my-list .list-item'):index===4?!!document.querySelector('#view article'):index===5?!!document.querySelector('#setting-panel'):text.includes('QA song')
            if(!ready){requestAnimationFrame(frame);return}
            requestAnimationFrame(()=>resolve({kind,index,label,selectedMs:selected,shellMs:shell,readyMs:performance.now()-start,domNodes:node.querySelectorAll('*').length,longTasks:window.qaPerf.long.filter(t=>t.start>=start).map(t=>t.duration)}))
          };requestAnimationFrame(frame)
        });return result
      },{kind,index})
      await page.waitForTimeout(100)
      const record={...value,round,requests:calls.slice(firstCall)};results.push(record)
      console.log(JSON.stringify({...record,requests:record.requests.map(r=>r.path)}))
    }
    for(let round=0;round<3;round++)for(const index of [1,2,3,4,5,0])await measure('main',index,round)
    await measure('main',5,3)
    for(let round=0;round<3;round++)for(const index of [3,4,6,0])await measure('setting',index,round)
    const assert=require('node:assert/strict')
    const nav=page.locator('[role="toolbar"] a[role="tab"]')
    taskUpdates.set('task_0',{status:'running',progress:20})
    await nav.nth(4).click()
    const first=page.locator('#view article').filter({has:page.locator('strong').filter({hasText:/^QA song 0$/})})
    await first.getByRole('button',{name:'暂停',exact:true}).click()
    await first.getByRole('button',{name:'继续 / 重试',exact:true}).click()
    await first.getByRole('button',{name:'暂停',exact:true}).waitFor()
    await page.waitForFunction(()=>document.querySelector('#view article')?.textContent.includes('下载中'))
    await nav.nth(0).click()
    const downloadCalls=()=>calls.filter(call=>call.path==='/api/v1/downloads').length
    const hiddenCalls=downloadCalls()
    await page.waitForTimeout(2900)
    assert.equal(downloadCalls(),hiddenCalls,'hidden cached download page must not poll')
    taskUpdates.set('task_0',{status:'paused',progress:87})
    await nav.nth(4).click()
    await page.waitForFunction(()=>document.querySelector('#view article')?.textContent.includes('87%'))
    const viewport=await page.evaluate(()=>{
      const list=[...document.querySelectorAll('#view .scroll')].find(el=>el.style.overflowY==='auto')
      list.scrollTop=list.scrollHeight
      return {height:list.clientHeight,scrollHeight:list.scrollHeight}
    })
    await page.getByText('QA song '+(downloads-1),{exact:true}).waitFor()
    const visibleArticles=await page.locator('#view article').count()
    assert.ok(visibleArticles<20,'download task DOM must stay bounded')
    await nav.nth(0).click();await nav.nth(4).click()
    await page.getByText('QA song '+(downloads-1),{exact:true}).waitFor()
    await page.evaluate(()=>{location.hash='/setting?name=SettingAccounts&provider=tx'})
    await page.waitForFunction(()=>document.getElementById('SettingAccounts-tab')?.getAttribute('aria-selected')==='true')
    await page.locator('#SettingAccounts-tab').focus();await page.keyboard.press('ArrowDown')
    await page.waitForFunction(()=>document.activeElement?.id==='SettingSource-tab')
    await page.evaluate(()=>{const tabs=document.querySelectorAll('[role="toolbar"] a[role="tab"]');for(const index of [0,3,1,4,2,0,1,3,2,4,0,5])tabs[index].click()})
    await page.waitForFunction(()=>document.querySelector('[role="toolbar"] a[href="#/setting"]')?.getAttribute('aria-selected')==='true'&&document.querySelectorAll('#view .view-container').length===1)
    assert.deepEqual(errors,[])
    const functional={pauseResume:true,hiddenPollingStopped:true,activationRefresh:true,virtualScrollToLast:true,scrollPositionRetained:true,visibleArticles,viewport,deepLink:true,keyboardNavigation:true,rapidSwitchClicks:12,singleVisiblePage:true}
    const cpu=(await cdp.send('Profiler.stop')).profile
    fs.writeFileSync(path.join(output,'renderer.cpuprofile'),JSON.stringify(cpu))
    const summary={version:webUrl?'web-build':await app.evaluate(({app})=>app.getVersion()),fixture:{delay,tracksPerPlaylist:tracks,userPlaylists:userLists.length,downloadTasks:downloads},results,functional,errors,calls}
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(summary,null,2))
    console.log('RESULTS '+output)
  } catch(e) {
    if(page){await page.screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure-calls.json'),JSON.stringify(calls,null,2))}
    throw e
  } finally {await app.close();fs.rmSync(profile,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
