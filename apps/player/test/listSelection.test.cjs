const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const vue = require('vue')

function fixture() {
  const listeners = new Map()
  const scope = vue.effectScope()
  const root = { contains: element => element?.inList }
  const document = { activeElement: { inList: true } }
  const context = { exports: {}, document, window: { key_event: { on: (name, fn) => listeners.set(name, fn), off: name => listeners.delete(name) } }, require: () => ({ ...vue, onBeforeUnmount: vue.onScopeDispose }) }
  const source = readSource(path.join(__dirname, '../src/renderer/utils/compositions/useListSelection.ts'))
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const list = [0, 1, 2, 3].map(id => ({ id }))
  const api = scope.run(() => context.exports.default(() => list, vue.ref({ $el: root })))
  return { ...api, list, listeners, document, stop: () => scope.stop(), ids: () => Array.from(api.selectedList.value, item => item.id) }
}

test('多选模式选空仍保留，反选可以从空恢复全选，行点击被消费不会播放', () => {
  const f = fixture()
  f.startSelection()
  assert.equal(f.isSelectionMode.value, true)
  assert.equal(f.handleSelectData(1, {}), true)
  assert.deepEqual(f.ids(), [1])
  f.toggleSelectData(1)
  assert.equal(f.isSelectionMode.value, true)
  assert.deepEqual(f.ids(), [])
  f.invertSelection()
  assert.deepEqual(f.ids(), [0, 1, 2, 3])
  f.invertSelection()
  assert.deepEqual(f.ids(), [])
  assert.equal(f.isSelectionMode.value, true)
  f.removeAllSelect()
  assert.equal(f.handleSelectData(2, {}), false)
  f.stop()
  assert.equal(f.listeners.size, 0)
})

test('右键只选当前歌曲，Ctrl及Shift支持离散和范围选择，非法下标不会加入空项', () => {
  const f = fixture()
  f.selectFromMenu(2)
  assert.deepEqual(f.ids(), [2])
  f.selectFromMenu(2)
  assert.deepEqual(f.ids(), [])
  f.removeAllSelect()
  assert.equal(f.handleSelectData(1, {}), false)
  f.handleSelectData(3, { shiftKey: true })
  assert.deepEqual(f.ids(), [1, 2, 3])
  f.handleSelectData(2, { ctrlKey: true })
  assert.deepEqual(f.ids(), [1, 3])
  f.toggleSelectData(-1)
  assert.deepEqual(f.ids(), [1, 3])
  f.stop()
})

test('Ctrl+A只响应列表焦点，不抢走搜索栏的文本选择', () => {
  const f = fixture()
  let prevented = 0
  const handler = f.listeners.get('key_mod+a_down')
  handler({ event: { target: { tagName: 'INPUT', type: 'text' }, preventDefault: () => prevented++ } })
  assert.deepEqual(f.ids(), [])
  handler({ event: { target: { tagName: 'INPUT', type: 'checkbox' }, preventDefault: () => prevented++ } })
  assert.deepEqual(f.ids(), [0, 1, 2, 3])
  assert.equal(prevented, 1)
  f.removeAllSelect()
  f.document.activeElement = { inList: false }
  handler({ event: { target: { tagName: 'DIV' }, preventDefault: () => prevented++ } })
  assert.equal(prevented, 1)
  f.stop()
})
