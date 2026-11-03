const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const asar = require('@electron/asar')
const { machOArchitectures, prepareDarwinDependencies, auditDarwinBundle } = require('../scripts/package-architecture.cjs')

function thin(cpu) {
  const buffer = Buffer.alloc(32)
  buffer.writeUInt32BE(0xcffaedfe)
  buffer.writeUInt32LE(cpu, 4)
  return buffer
}
function fat(magic, cpus) {
  const stride = magic === 0xcafebabf ? 32 : 20
  const buffer = Buffer.alloc(8 + cpus.length * stride)
  buffer.writeUInt32BE(magic)
  buffer.writeUInt32BE(cpus.length, 4)
  cpus.forEach((cpu, index) => buffer.writeUInt32BE(cpu, 8 + index * stride))
  return buffer
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tuneflow-arch-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
async function write(root, relative, bytes) {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
}

test('detects Intel slices in thin and universal Mach-O headers', () => {
  assert.deepEqual(machOArchitectures(thin(0x100000c)), ['arm64'])
  assert.deepEqual(machOArchitectures(thin(0x1000007)), ['x64'])
  for (const magic of [0xcafebabe, 0xcafebabf]) {
    assert.deepEqual(machOArchitectures(fat(magic, [0x1000007, 0x100000c])), ['x64', 'arm64'])
  }
  assert.equal(machOArchitectures(Buffer.from('ordinary JS source')), null)
  assert.throws(() => machOArchitectures(Buffer.from('cafebabe00000002', 'hex')), /Invalid universal/)
})

test('macOS staging keeps only target prebuilds and removes host builds', async(t) => {
  const root = await directory(t)
  for (const module of ['bufferutil', 'utf-8-validate']) {
    await write(root, `node_modules/${module}/build/Release/host.node`, thin(0x1000007))
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']) {
      await write(root, `node_modules/${module}/prebuilds/${target}/binding.node`, thin(target === 'darwin-arm64' ? 0x100000c : 0x1000007))
    }
  }
  await write(root, 'node_modules/font-list/libs/darwin/fontlist', thin(0x100000c))
  await write(root, 'node_modules/font-list/libs/win32/fontlist.exe', 'windows')
  await write(root, 'node_modules/font-list/libs/linux/index.js', 'linux')
  await prepareDarwinDependencies(root, 'arm64')
  for (const module of ['bufferutil', 'utf-8-validate']) {
    const folder = path.join(root, 'node_modules', module)
    assert.deepEqual(await fs.readdir(path.join(folder, 'prebuilds')), ['darwin-arm64'])
    await assert.rejects(fs.access(path.join(folder, 'build')))
  }
  await assert.rejects(fs.access(path.join(root, 'node_modules/font-list/libs/win32')))
  assert.equal((await auditDarwinBundle(root, 'arm64')).binaryCount, 3)
})

test('final audit rejects Intel code inside app.asar and universal helpers', async(t) => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  const bundle = path.join(root, 'TuneFlow.app')
  await fs.mkdir(bundle)
  await write(source, 'prebuilds/darwin-x64/module.node', thin(0x1000007))
  await asar.createPackage(source, path.join(bundle, 'app.asar'))
  await assert.rejects(auditDarwinBundle(bundle, 'arm64'), /app\.asar:.*darwin-x64/)
  await fs.rm(path.join(bundle, 'app.asar'))
  await write(bundle, 'helper', fat(0xcafebabf, [0x1000007, 0x100000c]))
  await assert.rejects(auditDarwinBundle(bundle, 'arm64'), /x64,arm64/)
})

test('final audit rejects non-macOS native modules', async(t) => {
  const root = await directory(t)
  await write(root, 'leftover.node', Buffer.from('7f454c4602010100', 'hex'))
  await assert.rejects(auditDarwinBundle(root, 'arm64'), /Non-macOS native module/)
})

test('Intel macOS target remains independently valid', async(t) => {
  const root = await directory(t)
  await write(root, 'TuneFlow', thin(0x1000007))
  assert.equal((await auditDarwinBundle(root, 'x64')).binaryCount, 1)
  await assert.rejects(auditDarwinBundle(root, 'arm64'), /expected arm64/)
})
