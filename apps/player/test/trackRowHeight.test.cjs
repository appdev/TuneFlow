const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const ts = require('typescript')
const { computed, reactive, ref } = require('vue')
const readSource = require('../../../scripts/read-source.cjs')
const path = require('node:path')

test('track row height updates with font settings and fullscreen sizing', () => {
  const isFullscreen = ref(false)
  const screenFontSize = ref(18)
  const appSetting = reactive({ 'common.fontSize': 16 })
  const dependencies = {
    '@common/utils/vueTools': { computed },
    '@renderer/store': { isFullscreen },
    '@renderer/store/setting': { appSetting },
    '@renderer/utils': { getFontSizeWithScreen: () => screenFontSize.value },
  }
  const source = readSource(path.join(__dirname, '../src/renderer/utils/compositions/useTrackRowHeight.ts'))
  const context = { exports: {}, require: name => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const height = context.exports.default()
  assert.equal(height.value, 56)
  appSetting['common.fontSize'] = 20
  assert.equal(height.value, 70)
  isFullscreen.value = true
  assert.equal(height.value, 63)
  screenFontSize.value = 24
  assert.equal(height.value, 84)
  isFullscreen.value = false
  appSetting['common.fontSize'] = 10
  assert.equal(height.value, 48)
})
