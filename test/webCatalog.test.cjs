const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const context = { exports: {}, require: name => {
  if (name.endsWith('/workspace')) return { installServiceCatalog: () => {} }
  if (name.endsWith('/session')) return { getWorkspace: () => { throw Error('Catalog initialization must not perform a network request') } }
  throw Error('Web catalog must not load native provider modules: ' + name)
} }
const source = fs.readFileSync(path.join(root, 'src/web-runtime/catalog.ts'), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const catalog = context.exports.default
for (const id of ['kw', 'kg', 'tx', 'wy', 'mg']) test(`${id} Web browse preserves the native sort contract and a usable default`, () => {
  const native = fs.readFileSync(path.join(root, `src/renderer/utils/musicSdk/${id}/songList.js`), 'utf8')
  const sorts = vm.runInNewContext(native.match(/sortList:\s*(\[[\s\S]*?\]),/)[1])
  const expected = Array.from(sorts, item => ({ id: String(item.id), name: item.name }))
  assert.deepEqual(JSON.parse(JSON.stringify(catalog[id].songList.sortList)), expected)
  assert.ok(catalog[id].songList.sortList[0].id)
})
