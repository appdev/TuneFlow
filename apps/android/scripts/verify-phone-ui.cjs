const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const load = file => {
  const context = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}
const { resolveAdaptiveLayout: layout } = load('src/utils/adaptiveLayout.ts')
const { adaptPhoneTheme, phonePalette } = load('src/theme/phone.ts')
test('phone presentation stays isolated from explicit tablet, automotive and wide modes', () => {
  for (const height of [844, 400, 260]) {
    const phone = layout(390, height, 'auto', false)
    assert.equal(phone.phone, true)
    assert.equal(phone.songRowHeight, 68)
  }
  for (const [w, h, mode, automotive] of [[393,844,'tablet',false],[393,844,'car',false],[1280,800,'auto',false],[800,480,'auto',true]]) {
    const result = layout(w,h,mode,w>h,automotive)
    assert.equal(result.phone, false)
    assert.equal(result.songRowHeight, result.isCar ? 72 : 54)
  }
  assert.equal(layout(1024,600,'phone',true,true).phone,true)
  const narrowTablet = layout(480,800,'auto',false,false,800)
  assert.equal(narrowTablet.phone,false)
  assert.equal(narrowTablet.songRowHeight,54)
})
const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
const luminance = hex => rgb(hex).reduce((a,v,i) => a+v*[.2126,.7152,.0722][i],0)
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05)
test('both classic phone appearances have readable text, selected controls and input boundaries', () => {
  for (const p of Object.values(phonePalette)) {
    assert.ok(contrast(p.ink,p.paper)>=4.5)
    assert.ok(contrast(p.muted,p.paper)>=4.5)
    assert.ok(contrast(p.muted,p.surface)>=4.5)
    assert.ok(contrast(p.accent,p.onAccent)>=4.5)
    assert.ok(contrast(p.field,p.surface)>=3)
  }
})
test('phone theme adapter never mutates shared theme or overwrites a custom accent', () => {
  const original = { id: 'custom', isDark: true, 'q-accent': '#e07040', 'q-accent-text': '#f0a080', 'q-on-accent': '#121212' }
  const before = JSON.stringify(original)
  const next = adaptPhoneTheme(original)
  assert.equal(next,original)
  assert.equal(JSON.stringify(original),before)
  assert.equal(next['q-accent'],original['q-accent'])
  assert.equal(next['q-accent-text'],original['q-accent-text'])
  assert.equal(next['q-on-accent'],original['q-on-accent'])
  const classic = adaptPhoneTheme({ ...original, id:'yesplay' })
  assert.ok(contrast(classic['q-text-primary'],classic['q-surface-base'])>=4.5)
})
