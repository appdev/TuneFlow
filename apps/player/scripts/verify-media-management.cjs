const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const roots = [path.resolve(__dirname, '../src/renderer/service'), path.resolve(__dirname, '../../android/src/service')]
function loader(root, overrides = {}) {
  const cache = new Map()
  const load = name => {
    if (cache.has(name)) return cache.get(name)
    const context = { exports: {}, fetch, AbortController, setTimeout, clearTimeout, require: id => id in overrides ? overrides[id] : load(id.replace('./', '')) }
    vm.runInNewContext(ts.transpileModule(readSource(path.join(root, name + '.ts')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
    cache.set(name, context.exports); return context.exports
  }
  return load
}
const track = { id: 'original', source: 'tx', name: 'Fixture song', singer: 'Fixture artist', interval: '03:00' }
for (const root of roots) {
  const label = root.includes('renderer') ? 'desktop/Web' : 'Android'
  test(label + ': selected quality requires explicit replacement confirmation; cancellation is read-only', async() => {
    const load = loader(root), { ServiceClient } = load('client'), { downloadWithConfirmation } = load('downloads')
    const calls = [], existing = { value: false }, active = []
    const client = new ServiceClient('http://fixture:3124', async(url, options) => {
      const body = options.body && JSON.parse(options.body); calls.push({ url, body, method: options.method })
      if (options.method === 'GET') return new Response(JSON.stringify({ data: active }))
      if (existing.value && body.existingFilePolicy === 'error') return new Response(JSON.stringify({ error: { code: 'DOWNLOAD_ALREADY_EXISTS' } }), { status: 409 })
      return new Response(JSON.stringify({ data: { id: 'job', status: 'waiting', quality: body.quality } }))
    })
    assert.equal(await downloadWithConfirmation(client, track, 'flac', async() => assert.fail('No conflict')), true)
    assert.equal(calls[0].body.existingFilePolicy, 'error')
    existing.value = true; calls.length = 0
    assert.equal(await downloadWithConfirmation(client, track, 'flac', async() => false), false)
    assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.body.existingFilePolicy), ['error'])
    calls.length = 0
    assert.equal(await downloadWithConfirmation(client, track, 'flac', async() => true), true)
    assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => [call.body.existingFilePolicy, call.body.quality]), [['error', 'flac'], ['replace', 'flac']])
    calls.length = 0; let current = true
    await assert.rejects(downloadWithConfirmation(client, track, 'flac', async() => { current = false; return true }, () => current), { code: 'SERVER_CHANGED' })
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)
    active.push({ status: 'paused', musicInfo: { ...track, id: 'other-platform', source: 'wy' } })
    await assert.rejects(downloadWithConfirmation(client, track, 'flac', async() => assert.fail('Active tasks must not be replaced')), { code: 'DOWNLOAD_TASK_ACTIVE' })
  })
  test(label + ': library deletion validates every origin before writing, deduplicates, and retains generic read-only guards', async() => {
    const load = loader(root), { ServiceClient } = load('client'), { ServiceWorkspace, LIBRARY_ID, HISTORY_ID } = load('workspace')
    const deleted = [], client = new ServiceClient('http://fixture:3124', async(url, options) => {
      assert.equal(options.method, 'DELETE'); deleted.push(url)
      return new Response(null, { status: 204 })
    })
    const workspace = new ServiceWorkspace(client)
    const local = { id: 'opaque-file', source: 'local', name: 'Fixture file' }
    const native = workspace.native(local, { ...local, musicInfo: local, streamUrl: '/api/v1/library/tracks/opaque-file/stream' })
    const foreign = new ServiceWorkspace(new ServiceClient('http://other:3124')).native(local)
    await assert.rejects(workspace.deleteLibraryTracks([native, foreign]), { code: 'DIFFERENT_SERVER' })
    await assert.rejects(workspace.deleteLibraryTracks([native, workspace.native(track)]), { code: 'INVALID_LIBRARY_TRACK' })
    assert.equal(deleted.length, 0)
    assert.deepEqual(JSON.parse(JSON.stringify(await workspace.deleteLibraryTracks([native, native]))), { deleted: 1, failed: 0 })
    assert.equal(deleted[0], 'http://fixture:3124/api/v1/library/tracks/opaque-file')
    for (const listId of [LIBRARY_ID, HISTORY_ID]) await assert.rejects(workspace.lists('music_remove', { listId, ids: [native.id] }), { code: 'LIBRARY_IS_READ_ONLY' })
    assert.equal(deleted.length, 1)
  })
  test(label + ': cancel, duplicate clicks and connection changes never delete files; confirmed failures refresh and report', async() => {
    let yes = false, current, refreshes = 0, writes = 0, messages = [], changeOnConfirm = false
    const workspace = { client: { endpoint: 'http://fixture:3124' }, deleteLibraryTracks: async() => { writes++; return { deleted: 1, failed: 1 } } }; current = workspace
    const confirm = async() => { if (changeOnConfirm) current = {}; return yes }
    const dialog = async options => { messages.push(options.message) }; dialog.confirm = confirm
    const load = loader(root, {
      './session': { getWorkspace: () => current, refreshServiceLists: async() => { refreshes++ } },
      '@renderer/plugins/Dialog': { dialog }, '@/utils/tools': { confirmDialog: confirm, toast: text => messages.push(text) },
    })
    const { deleteLibrarySelection } = load('libraryActions')
    await deleteLibrarySelection([track]); assert.equal(writes, 0)
    yes = true; changeOnConfirm = true
    await deleteLibrarySelection([track]); assert.equal(writes, 0)
    current = workspace; changeOnConfirm = false; messages = []
    await Promise.all([deleteLibrarySelection([track]), deleteLibrarySelection([track])])
    assert.equal(writes, 1); assert.equal(refreshes, 1); assert.match(messages[0], /已删除 1 首，1 首删除失败/)
  })
}
