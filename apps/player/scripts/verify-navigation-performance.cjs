const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { _electron } = require(path.join(serviceRoot, 'node_modules/playwright'))
const executablePath = process.env.Q_BENCH_EXE || path.join(root, 'artifacts/navigation-performance/darwin-arm64/mac-arm64/Q-music Docker Preview.app/Contents/MacOS/Q-music Docker Preview')
const output = process.env.Q_BENCH_OUT || path.join(root, 'artifacts/navigation-performance/verification/after.json')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-tab-bench-'))
const calls = []
const pageErrors = []
const song = i => ({ id: `qa_${i}`, source: 'kw', name: `QA song ${i}`, singer: 'QA artist', interval: '03:00', meta: { songId: String(i), albumName: 'QA album', qualitys: [{ type: '128k', size: null }] } })
const userLists = Array.from({length:3},(_,i)=>({id:`qa_list_${i}`,name:`QA playlist ${i}`,source:'kw'}))
const endpoints = url => {
  const p = new URL(url).pathname.replace('/api/v1/', '')
  if (p === 'health') return {status:'ok'}
  if (p === 'catalog/capabilities') return {sources:['kw','kg','tx','wy','mg'].map(id=>({id,name:id,searchKinds:['tracks','playlists','albums'],leaderboards:true,playlistDiscovery:{browse:true,detail:true}}))}
  if (p === 'events/snapshot') return {sequence:1,events:[]}
  if (p === 'settings') return {'download.maxDownloadNum':2,'download.savePath':'/qa','download.isEmbedPic':false}
  if (p === 'playlists') return userLists
  if (p.startsWith('playlists/')) { const id=p.split('/')[1]; return {id,name:id,tracks:Array.from({length:id==='default'?50:25},(_,i)=>song(i))} }
  if (p === 'library/tracks' || p === 'playback/history' || p === 'sources' || p === 'downloads') return []
  if (p === 'recommendations/daily') return {status:'ready',version:1,items:Array.from({length:30},(_,i)=>({track:song(i),recommendationItemId:`r${i}`}))}
  if (p === 'catalog/leaderboards') return {list:[{id:'1',providerId:'1',name:'QA Board'}]}
  if (p.endsWith('/tags')) return {groups:[],hotTags:[],sorts:[{id:'new',name:'New'}]}
  if (p.includes('picture')) return {url:'/api/v1/playback/resources/qa/picture'}
  return {source:'kw',list:[],total:0,page:1,limit:30,hasMore:false}
}
;(async()=>{
  const app=await _electron.launch({executablePath,args:[`--user-data-dir=${profile}`],timeout:60000})
  let page
  try{
    const context=app.context()
    await context.route('**/api/v1/**',async route=>{
      const req=route.request(); calls.push({path:new URL(req.url()).pathname,method:req.method()})
      await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({data:endpoints(req.url())})})
    })
    page=await app.firstWindow();await page.waitForLoadState('domcontentloaded')
    console.log('window-ready')
    page.on('pageerror', error=>{pageErrors.push(error.message); console.log('pageerror',error.message.slice(0,200))})
    await page.getByRole('button',{name:'接受',exact:true}).evaluate(button=>button.click())
    await page.locator('[role="toolbar"] a[role="tab"]').first().waitFor()
    await page.evaluate(()=>{localStorage.setItem('qmusic.docker.endpoint.v1','http://127.0.0.1:43999');localStorage.setItem('qmusic.service.daily.mode.v1','server')})
    await page.reload()
    console.log('reloaded')
    await page.locator('[role="toolbar"] a[role="tab"]').first().waitFor()
    await page.waitForTimeout(700)
    await page.evaluate(()=>{
      window.__perf={longTasks:[],nodes:{}}
      new PerformanceObserver(list=>{window.__perf.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))) }).observe({entryTypes:['longtask']})
    })
    const results=[]
    const measure=async(kind,index,round)=>{
      console.log('switch',kind,index,round)
      const before=calls.length
      const result=await page.evaluate(async({kind,index})=>{
        const selector=kind==='main'?'[role="toolbar"] a[role="tab"]':'[aria-label="设置分类"] button[role="tab"]'
        const tabs=document.querySelectorAll(selector); const target=tabs[index]
        if(!target) throw Error('Missing benchmark target')
        target.scrollIntoView({block:'nearest'})
        const label=target.getAttribute('aria-label')
        const route=target.getAttribute('href')?.split('?')[0]
        const start=performance.now();const from=document.querySelector('#view .view-container:not(.q-route-leave-active)')
        target.click()
        let selected,content
        const key=kind+':'+(route??label)
        const result=await new Promise((resolve,reject)=>{
          const deadline=start+10000
          const frame=()=>{
            const now=performance.now()
            if(now>deadline){reject(Error('Navigation did not settle: '+label));return}
            const active=target.getAttribute('aria-selected')==='true'
            if(active && selected==null)selected=now-start
            let node
            if(kind==='main'){
              node=Array.from(document.querySelectorAll('#view .view-container')).find(n=>n!==from && !n.classList.contains('q-route-leave-active') && !n.classList.contains('q-route-leave-to'))
              if(!active || !node){requestAnimationFrame(frame);return}
            }else{
              node=document.querySelector('#setting-panel > dl > div')
              if(!active || !node){requestAnimationFrame(frame);return}
            }
            const opacity=Number(getComputedStyle(node).opacity)
            if(content==null)content=now-start
            if(opacity<0.98 || node.classList.contains('q-route-enter-from')){requestAnimationFrame(frame);return}
            const prev=window.__perf.nodes[key];window.__perf.nodes[key]=node
            resolve({kind,label,selectedMs:selected,contentMs:content,visibleMs:now-start,reused:prev?prev===node:null,longTasks:window.__perf.longTasks.filter(t=>t.start>=start).map(t=>t.duration)})
          };requestAnimationFrame(frame)
        })
        return result
      },{kind,index})
      await page.waitForTimeout(100)
      results.push({...result,round,requests:calls.length-before})
      console.log('measured',JSON.stringify(results.at(-1)))
    }
    for(let round=0;round<3;round++)for(const index of [1,2,3,4,5,0])await measure('main',index,round)
    await measure('main',5,3)
    for(let round=0;round<3;round++)for(const index of [3,4,6,0])await measure('setting',index,round)
    await page.evaluate(()=>{location.hash='/setting?name=SettingAccounts&provider=tx'})
    await page.waitForFunction(()=>document.getElementById('SettingAccounts-tab')?.getAttribute('aria-selected')==='true')
    await page.locator('#SettingAccounts-tab').focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(()=>document.activeElement?.id==='SettingSource-tab' && document.getElementById('setting-panel')?.getAttribute('aria-labelledby')==='SettingSource-tab')
    await page.evaluate(()=>{
      const tabs=document.querySelectorAll('[role="toolbar"] a[role="tab"]')
      for(const index of [0,3,1,4,2,0,1,3,2,4,0,5])tabs[index].click()
    })
    await page.waitForFunction(()=>document.querySelector('[role="toolbar"] a[href="#/setting"]')?.getAttribute('aria-selected')==='true')
    await page.waitForTimeout(100)
    const pagesAfter100ms=await page.locator('#view .view-container').count()
    await page.waitForFunction(()=>document.querySelectorAll('#view .view-container').length===1,{},{timeout:3000})
    const pageCount=await page.locator('#view .view-container').count()
    if(pageCount!==1)throw Error('Rapid switching left overlapping page instances: '+pageCount)
    if(pageErrors.length)throw Error('Renderer errors during navigation: '+pageErrors.join('; '))
    const record={rapidSwitch:{clicks:12,finalRoute:'/setting',pagesAfter100ms,visiblePages:pageCount},settingsDeepLink:true,keyboardNavigation:true,pageErrors,version:await app.evaluate(({app})=>app.getVersion()),fixture:{userPlaylists:3,tracks:150},results,apiRequests:calls.length}
    fs.mkdirSync(path.dirname(output), {recursive:true})
    fs.writeFileSync(output,JSON.stringify(record,null,2))
    console.log(JSON.stringify(record,null,2))
  }catch(error){if(page){await page.screenshot({path:'/tmp/qmusic-tab-bench-error.png'});console.error((await page.locator('body').innerText()).slice(0,800))}throw error}
  finally{await app.close();fs.rmSync(profile,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
