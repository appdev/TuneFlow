// Run the actual Electron renderer with temporary IPC and in-memory API fixtures.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { _electron } = require('playwright')
const { createFixture, settings, account, proof } = require('./verify-cover-first-ui.cjs')
const root = path.resolve(__dirname, '..')
function loadSource(file) {
  const entry = new Module(file, module)
  entry.paths = Module._nodeModulePaths(path.dirname(file))
  entry.require = id => {
    if (!id.startsWith('.')) return require(id)
    const base = path.resolve(path.dirname(file), id)
    return loadSource(['.ts', '.js', '.json'].map(ext => base + ext).find(fs.existsSync))
  }
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file))
  entry._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return entry.exports
}
async function main() {
  const fixture = await createFixture()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-ui-native-'))
  const defaults = loadSource(path.join(root, 'src/common/defaultSetting.ts')).default
  const { adaptThemeAppearance } = loadSource(path.join(root, 'src/common/theme/appearance.ts'))
  const { buildThemeMaterial } = loadSource(path.join(root, 'src/common/theme/material.ts'))
  const themes = require('../src/common/theme/index.json')
  const theme = mode => {
    const current = adaptThemeAppearance(themes[0], mode === 'dark')
    return { id: current.id, colors: { ...current.config.themeColors, ...buildThemeMaterial(current.isDark), ...current.config.extInfo } }
  }
  fs.writeFileSync(path.join(temp, 'fixture.json'), JSON.stringify({ origin: fixture.origin, settings: { ...defaults, ...settings }, account, themes, light: theme('light'), dark: theme('dark') }))
  const preload = path.join(temp, 'preload.cjs')
  fs.writeFileSync(preload, `
const {ipcRenderer}=require('electron');
const fixture=require('./fixture.json');
const data=new Map();let settings={...fixture.settings};
localStorage.setItem('qmusic.docker.endpoint.v1',fixture.origin);
localStorage.setItem('qmusic.service.daily.mode.v1','server');
const emit=(key,value)=>ipcRenderer.emit(key,{},value);
ipcRenderer.invoke=async(name,params)=>{
 if(name==='common_get_app_setting')return settings;
 if(name==='common_set_app_setting'){Object.assign(settings,params);emit('winMain_on_config_change',params);if(Object.keys(params).some(k=>k.startsWith('theme.'))){const theme=fixture[settings['theme.appearance']];window.setTheme(theme.colors);emit('common_theme_change',{shouldUseDarkColors:settings['theme.appearance']==='dark',theme});}return;}
 if(name==='common_get_env_params')return {cmdParams:{},envParams:{},deeplink:'',urls:[]};
 if(name==='winMain_get_data')return data.get(params)||null;
 if(name==='winMain_get_hot_key')return {local:{enable:false,keys:{}},global:{enable:false,keys:{}}};
 if(name==='winMain_get_themes')return {themes:fixture.themes,userThemes:[],dataPath:''};
 if(name==='winMain_music_account_status')return fixture.account;
 if(name==='winMain_music_account_daily')return {list:[],status:'login_required'};
 if(name==='winMain_music_account_playlists')return {playlists:[],status:'login_required'};
 if(name==='dislike_get_dislike_music_infos')return {names:new Set(),musicNames:new Set(),singerNames:new Set(),rules:''};
 if(name.includes('get_palyer_lyric')||name.includes('get_lyric'))return {lyric:''};
 if(name==='common_get_system_fonts'||name==='winMain_get_other_source'||name.includes('sound_effect'))return [];
 if(name==='winMain_fullscreen')return false;
 return null;
};
ipcRenderer.send=(name,params)=>{if(name==='winMain_save_data')data.set(params.path,params.data);};
ipcRenderer.sendSync=()=>null;
document.addEventListener('DOMContentLoaded',()=>{window.setTheme(fixture.light.colors);document.body.appendChild(window.dom_style);},{once:true});
`)
  const mainFile = path.join(temp, 'main.cjs')
  fs.writeFileSync(mainFile, `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(temp, 'profile'))});
app.commandLine.appendSwitch('disable-http-cache');
app.whenReady().then(()=>{const window=new BrowserWindow({width:1440,height:900,show:false,titleBarStyle:'hiddenInset',webPreferences:{nodeIntegration:true,nodeIntegrationInWorker:true,contextIsolation:false,sandbox:false,preload:${JSON.stringify(preload)}}});window.loadFile(${JSON.stringify(path.join(root, 'dist/index.html'))},{query:{os:'mac',dt:'true'}});});
app.on('window-all-closed',()=>app.quit());
`)
  let app, page
  const errors = []
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [mainFile], timeout: 60000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } })
    await app.context().route('**/*', fixture.handleRoute)
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.tf-home section[role="button"]').waitFor({ timeout: 30000 })
    await page.waitForFunction(() => document.querySelectorAll('.tf-home img').length >= 9)
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.lxData.updateSetting({ 'theme.appearance': mode }), mode)
      await page.waitForFunction(mode => getComputedStyle(document.documentElement).getPropertyValue('--tf-color-scheme').trim() === mode, mode)
      for (const width of [1024, 1280, 1440]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
        await page.waitForTimeout(80)
        const layout = await page.evaluate(() => {
          const children = [...document.querySelector('#toolbar').children].filter(el => el.getBoundingClientRect().width && getComputedStyle(el).position !== 'absolute')
          return children.map(el => el.getBoundingClientRect().toJSON())
        })
        for (let i = 1; i < layout.length; i++) assert.ok(layout[i - 1].right <= layout[i].x + 1, `Native navigation overlaps at ${width}px`)
      }
      await page.screenshot({ path: path.join(proof, `desktop-home-${mode}.png`) })
      await page.locator('.tf-home section[role="button"]').click()
      await page.locator('.tf-playlist-detail ol.scroll > li').first().waitFor()
      await page.screenshot({ path: path.join(proof, `desktop-playlist-${mode}.png`) })
      await page.locator('.tf-playlist-detail > header > button').first().click()
    }
    await page.evaluate(origin => {
      Object.assign(window.lxData.musicInfo, { id: 'native_ui_display', name: '晨光序曲', singer: '音流示例乐队', album: '界面验收示例', pic: origin + '/__ui/cover/3.jpg', lrc: '[00:00.00]走过清晨的街道\n[00:10.00]听见风吹过树梢\n[00:20.00]把今天，慢慢听完。\n[00:30.00]让旋律在此刻停留\n[00:40.00]再向下一个路口出发' })
      window.app_event.lyricUpdated()
    }, fixture.origin)
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.lxData.updateSetting({ 'theme.appearance': mode }), mode)
      await page.locator('.q-player-footer button').first().click()
      await page.locator('.q-player-detail').waitFor()
      await page.locator('.q-player-detail .line-content').first().waitFor()
      await page.screenshot({ path: path.join(proof, `desktop-player-${mode}.png`) })
      await page.locator('.q-player-detail > button').first().click()
    }
    const layout = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, native: document.querySelector('.tf-app').classList.contains('mac-native-window'), nav: document.querySelectorAll('[data-tf-navigation] [role="tab"]').length }))
    assert.equal(layout.native, true)
    assert.equal(layout.nav, 6)
    assert.equal(layout.overflow, false)
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.blocked, [])
    const result = { passed: true, actualDesktopRenderer: true, isolatedIPC: true, serviceStarted: false, realUpstreamRequests: 0, screenshots: 6, layout, errors }
    fs.writeFileSync(path.join(proof, 'desktop-ui.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(proof, 'desktop-failure.png') }); fs.writeFileSync(path.join(proof, 'desktop-failure.txt'), JSON.stringify({ message: error.message, errors, text: await page.locator('body').innerText() }, null, 2)) }
    throw error
  } finally { if (app) await app.close(); await fixture.close(); fs.rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
