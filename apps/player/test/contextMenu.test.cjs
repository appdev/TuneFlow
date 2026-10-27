const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse } = require('@vue/compiler-sfc')

const source = file => fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8')
function load(code, dependencies, globals = {}) {
  const context = { exports: {}, ...globals, require: id => {
    if (!(id in dependencies)) throw Error('Unexpected dependency: ' + id)
    return dependencies[id]
  } }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports.default
}
const contextEvent = (x = 20, y = 40) => Object.assign(new Event('contextmenu', { cancelable: true }), { pageX: x, pageY: y })

for (const [name, file, kind] of [
  ['在线歌曲', 'components/material/OnlineList/useMenu.js', 'song'],
  ['我的音乐', 'views/List/MusicList/useMenu.js', 'song'],
  ['下载任务', 'views/Download/useMenu.js', 'task'],
  ['歌单', 'views/List/MyList/useMenu.js', 'playlist'],
  ['排行榜', 'views/Leaderboard/BoardList/useMenu.js', 'board'],
]) test(`${name}右键取消浏览器菜单，重复打开可更新位置，操作仍作用于所选项目`, async() => {
  const calls = []
  const item = { id: 'synthetic', source: 'tx', metadata: { musicInfo: { source: 'tx' } }, status: 'running' }
  const scope = vue.effectScope()
  const useMenu = load(source(file), {
    '@common/utils/vueTools': vue,
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/utils/musicSdk': { default: { tx: {} } },
    '@renderer/core/dislikeList': { hasDislike: () => false },
    '@renderer/service/tracks': { isServerLibraryTrack: () => false },
    '@renderer/store/list/state': { userLists: [item], defaultList: {}, loveList: {} },
    '@renderer/service/workspace': { isReadOnlyList: () => false },
    './actions': { addLocalFile() {} },
    '../action': { playSongListDetail: id => calls.push(id) },
    '@common/constants': { DOWNLOAD_STATUS: { ERROR: 'error', PAUSE: 'pause' } },
  })
  const menu = scope.run(() => useMenu({
    props: {}, emit() {}, assertApiSupport: () => true, readOnly: vue.ref(false),
    isSelectionMode: vue.ref(false), selectedList: vue.ref([]), activeTab: vue.ref('running'),
    list: kind === 'board' ? [item] : vue.ref([item]),
    handlePlayMusic: index => calls.push(index), handleRename: index => calls.push(index),
  }))
  try {
    const argument = kind === 'playlist' || kind === 'board' ? 0 : item
    const first = contextEvent()
    menu.showMenu(first, argument)
    await vue.nextTick()
    assert.equal(first.defaultPrevented, true)
    const visible = menu.isShowItemMenu ?? menu.isShowMenu
    assert.equal(visible.value, true)
    const repeated = contextEvent(70, 90)
    menu.showMenu(repeated, argument)
    await vue.nextTick()
    assert.equal(repeated.defaultPrevented, true)
    assert.equal(menu.menuLocation.x, 70)
    assert.equal(menu.menuLocation.y, 90)
    menu.menuClick({ action: kind === 'playlist' ? 'rename' : 'play' }, 0, 'tx')
    assert.equal(visible.value, false)
    assert.deepEqual(calls, [kind === 'board' ? 'synthetic' : 0])
  } finally { scope.stop() }
})

for (const file of [
  'components/base/Input.vue',
  'components/material/SearchInput.vue',
  'views/List/MusicList/components/SearchList.vue',
]) for (const platform of ['web', 'darwin']) test(`${file} 在 ${platform} 右键保留对应的文本操作`, () => {
  let reads = 0
  const events = []
  const component = load(parse(source(file)).descriptor.script.content, {
    '@common/utils/electron': { clipboardReadText: () => { reads++; return 'native clipboard' } },
    '@common/hotKey': { HOTKEY_COMMON: {} },
    '@renderer/store/setting': { appSetting: {} },
    '@common/utils': { debounce: fn => fn },
    '@common/utils/vueTools': vue,
    '@renderer/components/common/SourceIcon.vue': {},
  }, { process: { platform } })
  const input = { value: 'hello selected world', selectionStart: 6, selectionEnd: 14 }
  const instance = { $refs: { dom_input: input }, text: input.value, autoPaste: true, stopContentEventPropagation: true, $emit: (...args) => events.push(args) }
  const event = contextEvent()
  Object.defineProperty(event, 'target', { value: input })
  component.methods.handleContextMenu.call(instance, event)
  assert.equal(event.defaultPrevented, false)
  assert.equal(reads, platform === 'web' ? 0 : 1)
  if (platform === 'web') {
    assert.equal(input.value, 'hello selected world')
    assert.equal(instance.text, 'hello selected world')
    assert.equal(events.length, 0)
  } else {
    const changed = file === 'components/base/Input.vue' ? input.value : instance.text
    assert.equal(changed, 'hello native clipboard world')
  }
})
