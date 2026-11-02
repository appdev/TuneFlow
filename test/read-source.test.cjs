const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readSource = require('../scripts/read-source.cjs')

test('source loader follows pure facades but preserves mixed barrel implementations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-source-'))
  try {
    fs.writeFileSync(path.join(root, 'impl.ts'), 'export const value = 42\n')
    fs.writeFileSync(path.join(root, 'facade.ts'), "export * from './impl'\n")
    fs.writeFileSync(path.join(root, 'typed.ts'), "export * from './impl'\nimport type { Value } from './impl'\nexport type Local = Value<string>\n")
    const mixed = "export * from './impl'\nexport const local = 7\n"
    fs.writeFileSync(path.join(root, 'mixed.ts'), mixed)
    assert.equal(readSource(path.join(root, 'facade.ts')), 'export const value = 42\n')
    assert.equal(readSource(path.join(root, 'typed.ts')), 'export const value = 42\n')
    assert.equal(readSource(path.join(root, 'mixed.ts')), mixed)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
