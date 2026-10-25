const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const flush = async() => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

function mountDownloads() {
  const hooks = { mounted: [], activated: [], deactivated: [], unmounted: [] }
  const requests = [], actions = [], timers = new Map()
  let timerId = 0
  const vue = {
    ref: value => ({ value }), shallowRef: value => ({ value }), computed: get => ({ get value() { return get() } }),
    onMounted: callback => hooks.mounted.push(callback), onActivated: callback => hooks.activated.push(callback),
    onDeactivated: callback => hooks.deactivated.push(callback), onBeforeUnmount: callback => hooks.unmounted.push(callback),
  }
  const client = {
    downloads: signal => { const request = { signal, ...deferred() }; requests.push(request); return request.promise },
    downloadAction: (id, action) => { const request = { id, action, ...deferred() }; actions.push(request); return request.promise },
  }
  const dependencies = {
    vue,
    './session': { getWorkspace: () => ({ client }), LIBRARY_ID: 'service_library' },
    '@renderer/store/setting': { appSetting: { 'common.fontSize': 14 } },
    '@renderer/store': { isFullscreen: { value: false } },
    '@renderer/utils': { getFontSizeWithScreen: () => 18 },
    '@renderer/plugins/Dialog': { dialog: { confirm: async() => true } },
  }
  const context = { exports: {}, AbortController, defineOptions() {}, setTimeout: callback => { timers.set(++timerId, callback); return timerId }, clearTimeout: id => timers.delete(id), require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name)
    return dependencies[name]
  } }
  const file = path.join(__dirname, '../src/renderer/service/ServerDownloads.vue')
  const script = fs.readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const source = script + '\nexports.qa = { tasks, busy, error, load, act };'
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const emit = name => hooks[name].forEach(callback => callback())
  return { ...context.exports.qa, requests, actions, timers, emit }
}

test('mount plus activation starts one poll and hidden pages stop polling', async() => {
  const page = mountDownloads()
  page.emit('mounted'); page.emit('activated')
  assert.equal(page.requests.length, 1)
  page.requests[0].resolve([{ id: 'old' }]); await flush()
  assert.equal(page.timers.size, 1)
  page.emit('deactivated')
  assert.equal(page.timers.size, 0)
  page.emit('activated')
  assert.equal(page.requests.length, 2)
  assert.equal(page.tasks.value[0].id, 'old', 'cached content remains visible while refreshing')
  page.requests[1].resolve([{ id: 'fresh' }]); await flush()
  assert.equal(page.tasks.value[0].id, 'fresh')
  assert.equal(page.timers.size, 1)
})

test('late hidden responses cannot overwrite a newer activation or clear its busy state', async() => {
  const page = mountDownloads()
  page.emit('mounted')
  page.emit('deactivated')
  assert.equal(page.requests[0].signal.aborted, true)
  page.emit('activated')
  assert.equal(page.requests.length, 2)
  page.requests[0].resolve([{ id: 'stale' }]); await flush()
  assert.equal(page.tasks.value.length, 0)
  assert.equal(page.busy.value, true)
  page.requests[1].resolve([{ id: 'current' }]); await flush()
  assert.equal(page.tasks.value[0].id, 'current')
  assert.equal(page.busy.value, false)
  assert.equal(page.timers.size, 1)
})

test('navigation aborts remain silent and unmount releases timers and requests', async() => {
  const page = mountDownloads()
  page.emit('mounted'); page.emit('deactivated')
  page.requests[0].reject(Error('CANCELLED')); await flush()
  assert.equal(page.error.value, '')
  assert.equal(page.timers.size, 0)
  page.emit('activated'); page.emit('unmounted')
  assert.equal(page.requests[1].signal.aborted, true)
  page.requests[1].resolve([]); await flush()
  assert.equal(page.timers.size, 0)
})

test('a pause already sent to the server stays serialized across navigation', async() => {
  const page = mountDownloads()
  page.emit('mounted'); page.requests[0].resolve([{ id: 'task' }]); await flush()
  const action = page.act('task', 'pause')
  assert.equal(page.actions.length, 1)
  page.emit('deactivated'); page.emit('activated')
  assert.equal(page.busy.value, true)
  assert.equal(page.requests.length, 1)
  page.actions[0].resolve(); await flush()
  assert.equal(page.requests.length, 2)
  page.requests[1].resolve([{ id: 'task', status: 'paused' }]); await action
  assert.equal(page.tasks.value[0].status, 'paused')
  assert.equal(page.busy.value, false)
})
