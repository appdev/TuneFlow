const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.join(__dirname, '..')
const mobile = fs.existsSync(path.join(root, 'src/utils/playlistMerge.ts'))
const file = mobile ? 'src/utils/playlistMerge.ts' : 'src/common/utils/playlistMerge.ts'
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context)
const { mergeSourcePlaylist: merge, createSourceSnapshot: snapshot } = context.exports
const track = (id, source = 'wy', name = id) => ({ id, source, name })
const plain = value => JSON.parse(JSON.stringify(value))

test('三个平台同步保持远端增删排序，同时保留本地及其他平台追加歌曲', () => {
  for (const source of ['tx', 'wy', 'kg']) {
    const key = source + ':playlist'
    const original = [track('a', source), track('removed', source), track('b', source)]
    const manual = [track('extra', source), track('1', 'local'), track('b', 'other')]
    const remote = [track('b', source, 'updated'), track('new', source), track('a', source)]
    const merged = merge([...original, ...manual], remote, key, snapshot(key, original))
    assert.deepEqual(plain(merged), [...remote, ...manual])
    const second = merge(merged, [track('new', source)], key, plain(snapshot(key, remote)))
    assert.deepEqual(plain(second), [track('new', source), ...manual])
  }
})
test('旧列表没有快照和来源发生变化时保守保留额外歌曲；相同平台 ID 去重', () => {
  const current = [track('a'), track('extra'), track('a'), track('a', 'tx')]
  const remote = [track('a', 'wy', 'fresh'), track('a', 'wy', 'duplicate')]
  for (const previous of [undefined, snapshot('other:playlist', current)]) {
    assert.deepEqual(plain(merge(current, remote, 'wy:playlist', previous)), [remote[0], current[1], current[3]])
  }
  assert.equal(current.length, 4)
})
test('远端清空仅移除曾同步的歌曲；手动删除的本地补充不被复活', () => {
  const original = [track('a'), track('b')]
  const extra = track('local-add', 'tx')
  assert.deepEqual(plain(merge([...original, extra], [], 'wy:1', snapshot('wy:1', original))), [extra])
  assert.deepEqual(plain(merge(original, [], 'wy:1', snapshot('wy:1', original))), [])
})
test('快照仅含远端曲目且可序列化，保留同步期间追加的歌曲', () => {
  const remote = [track('a'), track('a')]
  const before = snapshot('wy:1', remote)
  const current = [...remote, track('just-added', 'kg')]
  assert.deepEqual(plain(before), { sourceKey: 'wy:1', musicKeys: ['wy:a'] })
  assert.deepEqual(plain(merge(current, [track('b')], 'wy:1', plain(before))), [track('b'), current[2]])
})
