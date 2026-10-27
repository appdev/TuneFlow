const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../apps/player/node_modules/typescript')
const root = path.join(__dirname, '..')
const moduleContext = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'packages/music-core/src/sourceChain.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, moduleContext)
const { splitSourceChain, toggleSource, moveSource } = moduleContext.exports
const plain = value => JSON.parse(JSON.stringify(value))
const sources = Object.freeze([
  Object.freeze({ id: 'b', enabled: true, priority: 1 }),
  Object.freeze({ id: 'off', enabled: false, priority: null }),
  Object.freeze({ id: 'a', enabled: true, priority: 0 }),
  Object.freeze({ id: 'c', enabled: true, priority: 2 }),
])

test('both source managers share enabled-only immutable ordering, independent of installation order', () => {
  const value = plain(splitSourceChain(sources))
  assert.deepEqual(value.enabled.map(source => source.id), ['a', 'b', 'c'])
  assert.deepEqual(value.disabled.map(source => source.id), ['off'])
  assert.deepEqual(plain(moveSource(sources, 'c', 0)), ['c', 'a', 'b'])
  assert.deepEqual(plain(moveSource(sources, 'a', 2)), ['b', 'c', 'a'])
  assert.deepEqual(plain(moveSource(sources, 'b', 2)), ['a', 'c', 'b'])
  for (const [id, position] of [['off', 0], ['missing', 0], ['a', -1], ['b', 3], ['c', NaN], ['b', 1.5]]) assert.deepEqual(plain(moveSource(sources, id, position)), ['a', 'b', 'c'])
  assert.deepEqual(sources.map(source => source.id), ['b', 'off', 'a', 'c'])
  for (const file of ['apps/player/src/renderer/service/sourceChain.ts', 'apps/android/src/service/sourceChain.ts']) {
    const absolute = path.join(root, file)
    const relative = /from '([^']+)'/.exec(fs.readFileSync(absolute, 'utf8'))[1]
    assert.equal(path.resolve(path.dirname(absolute), relative + '.ts'), path.join(root, 'packages/music-core/src/sourceChain.ts'))
  }
})

test('enable appends once, disable keeps the remaining order and unknown sources cannot enter the chain', () => {
  assert.deepEqual(plain(toggleSource(sources, 'off', true)), ['a', 'b', 'c', 'off'])
  assert.deepEqual(plain(toggleSource(sources, 'b', true)), ['a', 'b', 'c'])
  assert.deepEqual(plain(toggleSource(sources, 'b', false)), ['a', 'c'])
  assert.deepEqual(plain(toggleSource(sources, 'missing', true)), ['a', 'b', 'c'])
})

test('Android file import rejects oversized or wrong-extension files, handles cancellation and cleans only its cache', async() => {
  const file = fs.readFileSync(path.join(root, 'apps/android/src/service/importSourceFile.ts'), 'utf8')
  for (const scenario of ['ok', 'cancel', 'large', 'extension', 'install-failure']) {
    const calls = []
    let cache
    const context = { exports: {}, Date, require: id => {
      assert.equal(id, '@/utils/fs')
      return {
        temporaryDirectoryPath: '/test-cache',
        mkdir: async name => { assert.ok(name.startsWith('/test-cache/tuneflow-source-')) },
        selectFile: async options => { cache = options.toPath; return scenario === 'cancel' ? null : { name: scenario === 'extension' ? 'source.zip' : 'source.js', data: cache + '/source.js' } },
        stat: async name => { assert.equal(name, cache + '/source.js'); return { size: scenario === 'large' ? 1024 * 1024 + 1 : 12 } },
        readFile: async name => { assert.equal(name, cache + '/source.js'); calls.push('read'); return '// fixture' },
        unlink: async name => { assert.equal(name, cache); calls.push('clean') },
      }
    } }
    vm.runInNewContext(ts.transpileModule(file, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
    const result = context.exports.importSourceFile(async script => { assert.equal(script, '// fixture'); calls.push('install'); if (scenario === 'install-failure') throw Error('rejected') })
    if (['large', 'extension', 'install-failure'].includes(scenario)) await assert.rejects(result)
    else assert.equal(await result, scenario === 'ok')
    assert.equal(calls.at(-1), 'clean')
    if (['cancel', 'large', 'extension'].includes(scenario)) assert.ok(!calls.includes('read') && !calls.includes('install'))
  }
})
