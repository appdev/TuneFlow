const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function mountList() {
  const mounted = [], unmounted = [], activated = [], deactivated = [], ticks = [], frames = [], watches = [], events = new Map()
  const vue = {
    ref: value => ({ value }), computed: get => ({ get value() { return get() } }),
    nextTick: callback => { ticks.push(callback); return Promise.resolve() },
    watch: (source, callback) => watches.push({ source, callback }),
    onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback),
    onActivated: callback => activated.push(callback), onDeactivated: callback => deactivated.push(callback),
  }
  const timers = []
  const context = { exports: {}, require: () => vue, requestAnimationFrame: callback => frames.push(callback), setTimeout: callback => timers.push(callback), clearTimeout() {}, window: { addEventListener() {}, removeEventListener() {}, setTimeout: callback => timers.push(callback), clearTimeout() {} } }
  const file = path.join(__dirname, '../src/renderer/components/base/VirtualizedList.vue')
  const source = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const props = { list: Array.from({ length: 6000 }, (_, id) => ({ id })), itemHeight: 34, keyName: 'id' }
  const component = context.exports.default.setup(props, { emit() {} })
  const scroll = { scrollTop: 0, clientHeight: 360, addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name) }
  component.dom_scrollContainer.value = scroll
  mounted.forEach(callback => callback())
  const flushTicks = () => { while (ticks.length) ticks.shift()() }
  const flushFrames = () => { frames.splice(0).forEach(callback => callback()) }
  return { props, component, scroll, events, watches, frames, flushTicks, flushFrames, activate: () => activated.forEach(callback => callback()), deactivate: () => deactivated.forEach(callback => callback()), unmount: () => { unmounted.forEach(callback => callback()); component.dom_scrollContainer.value = null } }
}

test('large lists show only viewport rows as soon as the mounted DOM is ready', () => {
  const list = mountList()
  list.flushTicks()
  assert.equal(list.component.views.value.length, 12)
  assert.equal(list.component.views.value[0].item.id, 0)
  assert.equal(list.frames.length, 0, 'first rows must not wait for extra animation frames')
})

test('replacing data shows new rows without an empty animation frame', () => {
  const list = mountList()
  list.flushTicks()
  list.props.list = Array.from({ length: 100 }, (_, index) => ({ id: index + 9000 }))
  list.watches.find(watch => watch.source() === list.props.list).callback(list.props.list)
  list.flushTicks()
  assert.equal(list.component.views.value[0].item.id, 9000)
  assert.equal(list.frames.length, 0)
})

test('scrolling keeps frame scheduling and renders the correct viewport', () => {
  const list = mountList()
  list.flushTicks()
  list.scroll.scrollTop = 3400
  list.events.get('scroll')({})
  assert.equal(list.component.views.value[0].index, 0)
  list.flushFrames()
  assert.equal(list.component.views.value[0].index, 100)
  assert.equal(list.component.views.value.length, 12)
})

test('queued mount and scroll work are harmless after unmount', () => {
  const mounting = mountList()
  mounting.unmount()
  assert.doesNotThrow(mounting.flushTicks)
  const scrolling = mountList()
  scrolling.flushTicks()
  scrolling.scroll.scrollTop = 3400
  scrolling.events.get('scroll')({})
  scrolling.unmount()
  assert.doesNotThrow(scrolling.flushFrames)
  assert.equal(scrolling.events.size, 0)
})

test('cached hidden views skip rendering and restore the resized viewport on activation', () => {
  const list = mountList()
  list.flushTicks()
  list.deactivate()
  list.scroll.scrollTop = 3400
  list.events.get('scroll')({})
  list.flushFrames()
  assert.equal(list.component.views.value[0].index, 0)
  list.scroll.clientHeight = 700
  list.activate()
  list.flushTicks()
  assert.equal(list.component.views.value[0].index, 0)
  assert.equal(list.component.views.value.length, 22)
  assert.equal(list.frames.length, 0)
})

test('cached views restore the scroll offset when DOM removal resets scrollTop', () => {
  const list = mountList()
  list.flushTicks()
  list.scroll.scrollTop = 3400
  list.events.get('scroll')({})
  list.flushFrames()
  list.deactivate()
  list.scroll.scrollTop = 0
  list.activate()
  list.flushTicks()
  assert.equal(list.scroll.scrollTop, 3400)
  assert.equal(list.component.views.value[0].index, 100)
})
