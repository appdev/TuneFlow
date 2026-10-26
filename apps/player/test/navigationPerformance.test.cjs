const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function diagnostics({ enabled = false, development = false, document } = {}) {
  const calls = []
  const context = {
    exports: {}, process: { env: { NODE_ENV: development ? 'development' : 'production' } },
    window: { localStorage: { getItem: () => enabled ? '1' : null }, location: { hash: '#/search' }, getComputedStyle: () => ({ display: 'block', opacity: '1', visibility: 'visible', overflow: 'auto' }) },
    document: document ?? { getElementById: () => { throw Error('navigation must not force a DOM measurement') } },
    require: id => { assert.equal(id, '@common/utils'); return { log: { info: (...args) => calls.push(['info', ...args]), error: (...args) => calls.push(['error', ...args]) } } },
  }
  const source = readSource(path.join(__dirname, '../src/renderer/utils/debugLog.ts'))
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context.exports, calls }
}

test('production navigation and setting clicks do not measure or serialize layout', () => {
  const debug = diagnostics()
  for (const label of ['route:afterEach', 'route:afterEach:100ms', 'setting:toggleTab', 'play-detail:reset-on-route']) debug.logRendererState(label, { to: '/list' })
  assert.equal(debug.calls.length, 0)
})

test('production router/Vue/window errors remain logged without full DOM snapshots', () => {
  const debug = diagnostics()
  for (const label of ['router:error', 'vue:error', 'window:error', 'window:unhandledrejection']) debug.logRendererState(label, { message: 'test error' })
  assert.equal(debug.calls.length, 4)
  assert.ok(debug.calls.every(call => call[0] === 'error' && call.at(-1).includes('test error')))
})

for (const mode of ['explicit', 'development']) test(`${mode} diagnostics still provide layout snapshots`, () => {
  let measurements = 0
  const node = { className: 'qa', children: [], getBoundingClientRect: () => { measurements++; return { width: 800, height: 600 } } }
  const debug = diagnostics({ enabled: mode === 'explicit', development: mode === 'development', document: { getElementById: () => node, documentElement: { className: '' }, body: { className: '' } } })
  debug.logRendererState('route:afterEach')
  assert.equal(measurements, 4)
  assert.equal(debug.calls[0][0], 'info')
  assert.equal(JSON.parse(debug.calls[0].at(-1)).view.width, 800)
})

test('disabling layout diagnostics keeps stale-modal cleanup and preserves active dialogs', () => {
  const removed = []
  const make = active => ({ children: active ? [{ dataset: { modalContainer: 'true' } }] : [], classList: { contains: () => true, remove: name => removed.push(name) } })
  const nodes = { root: make(false), view: make(true) }
  const debug = diagnostics({ document: { getElementById: id => nodes[id] } })
  debug.cleanupStaleModalClass()
  assert.deepEqual(removed, ['show-modal'])
})
