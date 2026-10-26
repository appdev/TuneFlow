const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const vue = require('vue')

function load(name, deps, base = 'renderer') {
  const context = { exports: {}, process, require: id => {
    if (id in deps) return deps[id]
    throw Error(id)
  } }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/', base, name)), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}

function actions({ confirm = true, deleteFiles = false, failFile = '', pause } = {}) {
  const calls = []
  const tasks = [0, 1].map(id => ({ id: String(id), metadata: { filePath: 'C:/old/song' + id + '.mp3', fileName: 'song' + id + '.mp3' } }))
  const dialog = async info => { calls.push(['message', info.message]) }
  dialog.confirm = async info => { info.onCheckboxChange(deleteFiles); return confirm }
  const api = load('views/Download/useTaskActions.js', {
    '@common/utils/vueRouter': { useRouter: () => ({}) },
    '@renderer/utils/musicSdk': { default: {} },
    '@common/utils/electron': {},
    '@common/utils/nodejs': { joinPath: path.win32.join },
    '@renderer/plugins/Dialog': { dialog },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/setting': { appSetting: { 'download.savePath': 'C:/new' } },
    '@common/utils/vueTools': vue,
    '@renderer/utils/index': {},
    '@renderer/utils/ipc': {},
    '@renderer/store/download/action': {
      removeDownloadTasks: async ids => calls.push(['remove', ...ids]),
      pauseDownloadTasks: async() => { calls.push(['pause']); await pause?.(); calls.push(['stopped']) },
    },
    '@renderer/utils/removeLocalMusic': {
      trashLocalMusicFile: async file => { calls.push(['trash', file]); if (file == failFile) throw Error('locked') },
      removeLocalMusicReferences: async files => calls.push(['cleanup', ...files]),
    },
  }).default({ list: vue.ref(tasks), selectedList: vue.ref(tasks), removeAllSelect: () => calls.push(['clear']) })
  return { api, calls }
}

test('取消移除保留任务和选择；只移除记录不删除文件', async() => {
  const cancel = actions({ confirm: false })
  await cancel.api.handleRemoveTask(-1)
  assert.deepEqual(cancel.calls, [])
  const keep = actions()
  await keep.api.handleRemoveTask(-1)
  assert.deepEqual(keep.calls, [['remove', '0', '1'], ['clear']])
})

test('删除等待下载完全停止，沿用旧文件路径，失败任务不被移除', async() => {
  let stop
  const f = actions({ deleteFiles: true, failFile: 'C:/old/song1.mp3', pause: () => new Promise(resolve => { stop = resolve }) })
  const pending = f.api.handleRemoveTask(-1)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls, [['pause']])
  await f.api.handleRemoveTask(-1)
  assert.deepEqual(f.calls, [['pause']])
  stop()
  await pending
  assert.deepEqual(f.calls, [['pause'], ['stopped'], ['trash', 'C:/old/song0.mp3'], ['cleanup', 'C:/old/song0.mp3'], ['trash', 'C:/old/song1.mp3'], ['remove', '0'], ['message', 'local_remove_failed']])
})

test('清理全部本地引用，保留线上歌曲和其他文件；文件删除仅进入回收站', async() => {
  const removed = []
  const trashed = []
  const file = path.resolve('test-song.mp3')
  const main = load('utils/trashLocalMusic.ts', {
    electron: { shell: { trashItem: async file => trashed.push(file) } },
    'node:fs/promises': { lstat: async file => {
      if (file.endsWith('.lrc') || file.endsWith('.mp3')) return { isFile: () => true, isSymbolicLink: () => false }
      throw Object.assign(Error('missing'), { code: 'ENOENT' })
    } },
    'node:path': path,
    '@common/utils/localMusicFiles': { localAudioExtensions: ['mp3'] },
  }, 'main')
  const api = load('utils/removeLocalMusic.ts', {
    'node:path': path,
    '@renderer/utils/ipc': main,
    '@renderer/store/list/state': { defaultList: { id: 'default' }, loveList: { id: 'love' }, tempList: { id: 'temp' }, userLists: [{ id: 'local' }] },
    '@renderer/store/list/action': {
      getListMusics: async() => [
        { id: 'deleted', source: 'local', meta: { filePath: file } },
        { id: 'online', source: 'tx', meta: { filePath: file } },
        { id: 'keep', source: 'local', meta: { filePath: path.resolve('keep.mp3') } },
      ],
      removeListMusics: async value => removed.push({ listId: value.listId, ids: Array.from(value.ids) }),
    },
  })
  await api.trashLocalMusic({ meta: { filePath: file } })
  assert.equal(removed.length, 4)
  assert.ok(removed.every(item => item.ids.join() == 'deleted'))
  assert.ok(trashed.includes(file))
  await assert.rejects(api.trashLocalMusicFile('relative.mp3'))
  await assert.rejects(api.trashLocalMusicFile(path.resolve('not-audio.txt')))
})
