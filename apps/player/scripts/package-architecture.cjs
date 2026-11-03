const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')

const cpuName = cpu => ({ 7: 'ia32', 12: 'arm', 0x1000007: 'x64', 0x100000c: 'arm64' })[cpu] || `cpu-${cpu.toString(16)}`
function machOArchitectures(buffer) {
  if (buffer.length < 4) return null
  const magic = buffer.readUInt32BE(0)
  if ([0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface].includes(magic)) {
    if (buffer.length < 8) throw new Error('Truncated Mach-O header')
    return [cpuName([0xcffaedfe, 0xcefaedfe].includes(magic) ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4))]
  }
  if (![0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) return null
  const little = [0xbebafeca, 0xbfbafeca].includes(magic)
  const read = offset => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
  if (buffer.length < 8) throw new Error('Truncated universal Mach-O header')
  const count = read(4)
  const stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20
  if (!count || count > 64 || buffer.length < 8 + count * stride) throw new Error('Invalid universal Mach-O header')
  return Array.from({ length: count }, (_, index) => cpuName(read(8 + index * stride)))
}

async function * files(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) yield * files(file)
    else if (entry.isFile()) yield file
  }
}

function checkBinary(buffer, file, arch, results) {
  const architectures = machOArchitectures(buffer)
  if (!architectures) {
    if (file.endsWith('.node')) throw new Error(`Non-macOS native module: ${file}`)
    return
  }
  if (architectures.length !== 1 || architectures[0] !== arch) throw new Error(`Packaged architecture mismatch: ${file} (${architectures.join(',')}; expected ${arch})`)
  results.push({ path: file, architectures })
}

// Operate only on the disposable package stage, never the developer's node_modules.
async function prepareDarwinDependencies(stage, arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`)
  for (const name of ['bufferutil', 'utf-8-validate']) {
    const module = path.join(stage, 'node_modules', name)
    const prebuilds = path.join(module, 'prebuilds')
    const target = `darwin-${arch}`
    await fs.access(path.join(prebuilds, target))
    // node-gyp-build prefers build/Release over prebuilds; host builds must not win.
    await fs.rm(path.join(module, 'build'), { recursive: true, force: true })
    for (const entry of await fs.readdir(prebuilds)) {
      if (entry !== target) await fs.rm(path.join(prebuilds, entry), { recursive: true, force: true })
    }
  }
  const fontLibs = path.join(stage, 'node_modules/font-list/libs')
  for (const platform of ['linux', 'win32']) await fs.rm(path.join(fontLibs, platform), { recursive: true, force: true })
  for await (const file of files(stage)) {
    const architectures = machOArchitectures(await fs.readFile(file))
    if (!architectures) continue
    if (!architectures.includes(arch)) throw new Error(`Staged architecture mismatch: ${file} (${architectures.join(',')})`)
    if (architectures.length > 1) {
      const temporary = file + '.thin'
      try {
        execFileSync('lipo', [file, '-thin', arch === 'x64' ? 'x86_64' : arch, '-output', temporary])
        await fs.chmod(temporary, (await fs.stat(file)).mode & 0o777)
        await fs.rename(temporary, file)
      } finally { await fs.rm(temporary, { force: true }) }
    }
  }
}

async function auditDarwinBundle(bundle, arch) {
  const results = []
  for await (const file of files(bundle)) {
    const relative = path.relative(bundle, file)
    const buffer = await fs.readFile(file)
    checkBinary(buffer, relative, arch, results)
    if (!file.endsWith('.asar')) continue
    for (const entry of asar.listPackage(file)) {
      const archivePath = entry.replace(/^[/\\]/, '')
      const metadata = asar.statFile(file, archivePath)
      if (metadata.files || metadata.link) continue
      checkBinary(asar.extractFile(file, archivePath), `${relative}:${archivePath}`, arch, results)
    }
  }
  if (!results.length) throw new Error(`No Mach-O binaries found in ${bundle}`)
  return { target: `darwin-${arch}`, binaryCount: results.length, binaries: results }
}

module.exports = { machOArchitectures, prepareDarwinDependencies, auditDarwinBundle }
