const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const vue = require('vue')

function fixture(save) {
  const calls = []
  let options
  const context = { exports: {}, performance, window: { i18n: { t: key => key } }, require: id => {
    if (id == '@common/utils/vueTools') return { ...vue, useCssModule: () => ({ editing: 'editing' }) }
    if (id == '@renderer/utils/compositions/useDrag') return { default: opts => { options = opts; return { setDisabled: value => calls.push(['disabled', value]) } } }
    if (id == '@renderer/store/list/action') return { updateUserListPosition: value => { calls.push(['save', value.position]); return save() }, getUserLists: async() => calls.push(['restore']) }
    if (id == '@renderer/store/list/listManage/action') return { userListsUpdatePosition: (position, ids) => calls.push(['optimistic', position, ...ids]) }
    if (id == '@renderer/plugins/Dialog') return { dialog: async() => calls.push(['error']) }
    throw Error(id)
  } }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/renderer/views/List/MyList/useDarg.ts')), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const api = context.exports.default({ dom_lists_list: vue.ref(null), handleMenuClick: () => {} })
  const event = { item: { dataset: { listId: 'local' }, remove: () => calls.push(['restore-dom']) }, from: { children: [], insertBefore: () => {} } }
  return { options, api, event, calls }
}

test('拖动先在当前帧更新顺序，保存期间阻止再次拖动，落下不误切歌单', async() => {
  let resolve
  const f = fixture(() => new Promise(done => { resolve = done }))
  f.options.onDragStart()
  assert.equal(f.api.suppressDragClick(), true)
  f.options.onUpdate(4, 7, f.event)
  assert.deepEqual(f.calls, [['restore-dom'], ['optimistic', 2, 'local'], ['disabled', true], ['save', 2]])
  f.options.onDragEnd(f.event)
  assert.equal(f.api.suppressDragClick(), true)
  resolve()
  await new Promise(done => setImmediate(done))
  assert.deepEqual(f.calls.at(-1), ['disabled', false])
})

test('拖动保存失败重新读取已存顺序；固定列表不可被移入', async() => {
  const f = fixture(async() => { throw Error('disk error') })
  f.options.onUpdate(3, 6, f.event)
  assert.deepEqual(f.calls, [['restore-dom']])
  f.options.onUpdate(4, 6, f.event)
  await new Promise(done => setImmediate(done))
  assert.deepEqual(f.calls.slice(-3), [['restore'], ['error'], ['disabled', false]])
})
