// Build isolated previews without mutating the host's native bindings.
// npm run build first; targets are staged and packaged sequentially.
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const builder = require('electron-builder')
const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const electronVersion = pkg.devDependencies.electron
const abi = require('node-abi').getAbi(electronVersion, 'electron')
const targets = process.argv.slice(2)
if (!targets.length) targets.push(`${process.platform}-${process.arch}`)
const verifyNative = async(file, platform, arch) => {
  const buffer = await fs.readFile(file)
  let actual
  if (buffer.subarray(0, 4).toString('hex') === 'cffaedfe') {
    const cpu = buffer.readUInt32LE(4)
    actual = cpu === 0x100000c ? 'darwin-arm64' : cpu === 0x1000007 ? 'darwin-x64' : 'unknown'
  } else if (buffer.subarray(0, 4).toString('hex') === '7f454c46') {
    const cpu = buffer.readUInt16LE(18)
    actual = cpu === 183 ? 'linux-arm64' : cpu === 62 ? 'linux-x64' : 'unknown'
  } else if (buffer.subarray(0, 2).toString() === 'MZ') {
    const cpu = buffer.readUInt16LE(buffer.readUInt32LE(0x3c) + 4)
    actual = cpu === 0xaa64 ? 'win32-arm64' : cpu === 0x8664 ? 'win32-x64' : 'unknown'
  }
  if (actual !== `${platform}-${arch}`) throw new Error(`Native binding target mismatch: ${path.basename(file)} (${actual})`)
}
const run = async(target) => {
  if (!/^(darwin-(arm64|x64)|win32-(x64|arm64)|linux-(x64|arm64))$/.test(target)) throw new Error('Unsupported preview target: ' + target)
  const [platform, arch] = target.split('-')
  const stage = path.join(root, 'build/service-stage', target)
  const output = path.join(process.env.Q_PREVIEW_OUTPUT_ROOT || path.join(root, 'artifacts/navigation-performance'), target)
  // Only this script's disposable per-target staging folder is replaced.
  await fs.rm(stage, { recursive: true, force: true })
  await fs.mkdir(stage, { recursive: true })
  await fs.cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true, force: true })
  const dependencies = {}
  const copied = new Set()
  const copyDependency = async(name) => {
    if (copied.has(name)) return
    copied.add(name)
    const location = path.join(root, 'node_modules', name)
    const metadata = JSON.parse(await fs.readFile(path.join(location, 'package.json'), 'utf8'))
    await fs.cp(location, path.join(stage, 'node_modules', name), { recursive: true })
    // prebuild-install runs only during npm install; SQLite uses bindings at runtime.
    if (name === 'better-sqlite3') {
      delete metadata.dependencies['prebuild-install']
      await fs.writeFile(path.join(stage, 'node_modules', name, 'package.json'), JSON.stringify(metadata))
    }
    for (const child of Object.keys(metadata.dependencies ?? {})) await copyDependency(child)
  }
  for (const name of ['better-sqlite3', 'font-list', 'bufferutil', 'utf-8-validate']) {
    await copyDependency(name)
    dependencies[name] = pkg.dependencies[name]
  }
  const bindingTarget = path.join(stage, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  await fs.mkdir(path.dirname(bindingTarget), { recursive: true })
  let sqliteSource
  if (platform === 'linux') {
    sqliteSource = path.join(root, `build-config/lib/better_sqlite3_electron-v${abi}-${target}.node`)
  } else {
    // Use publisher Electron ABI prebuilds, never a host Node.js ABI binding.
    const version = require('better-sqlite3/package.json').version
    const cacheDir = path.join(root, 'artifacts/native-cache', target)
    await fs.mkdir(cacheDir, { recursive: true })
    sqliteSource = path.join(cacheDir, 'build/Release/better_sqlite3.node')
    try { await fs.access(sqliteSource) } catch {
      const archive = path.join(cacheDir, 'sqlite.tar.gz')
      const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-electron-v${abi}-${target}.tar.gz`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Native prebuild unavailable (${response.status}): ${target}`)
      await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()))
      const result = spawnSync('tar', ['-xzf', archive, '-C', cacheDir], { stdio: 'inherit' })
      if (result.status !== 0) throw new Error('Native prebuild extraction failed')
    }
  }
  await fs.copyFile(sqliteSource, bindingTarget)
  const qrc = path.join(root, `build-config/lib/qrc_decode_electron-v${abi}-${target}.node`)
  await verifyNative(sqliteSource, platform, arch)
  await verifyNative(qrc, platform, arch)
  await fs.mkdir(path.join(stage, 'build/Release'), { recursive: true })
  await fs.copyFile(qrc, path.join(stage, 'build/Release/qrc_decode.node'))
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'tuneflow', version: process.env.Q_PREVIEW_VERSION || pkg.version, main: 'dist/main.js', description: 'TuneFlow music client', author: pkg.author, license: pkg.license, dependencies }, null, 2))
  const config = {
    appId: 'io.github.qmusic.docker.preview', productName: 'TuneFlow', electronVersion,
    directories: { app: stage, output, buildResources: path.join(root, 'resources') },
    npmRebuild: false, nodeGypRebuild: false, asar: { smartUnpack: false },
    files: ['dist/**/*', 'build/Release/qrc_decode.node', 'package.json', 'node_modules/**/*'],
    extraResources: [{ from: path.join(root, 'licenses'), to: 'licenses' }, { from: path.join(root, 'NOTICE'), to: 'NOTICE' }, { from: path.join(root, 'LICENSE'), to: 'LICENSE' }],
    publish: null, artifactName: 'TuneFlow-${version}-${os}-${arch}.${ext}',
    mac: { identity: '-', hardenedRuntime: false, gatekeeperAssess: false, icon: path.join(root, 'resources/icons/icon.icns'), category: 'public.app-category.music', target: ['zip'] },
    win: { icon: path.join(root, 'resources/icons/icon.ico'), target: ['zip'], signAndEditExecutable: true },
    linux: { executableName: 'TuneFlow', icon: path.join(root, 'resources/icons'), category: 'AudioVideo', target: ['tar.gz'], maintainer: 'TuneFlow contributors' },
  }
  const option = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'
  await builder.build({ [option]: config[option].target, [arch]: true, publish: 'never', config })
  const hash = async(file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
  const binaries = { sqlite: { source: path.relative(root, sqliteSource), sha256: await hash(sqliteSource) }, qrc: { source: path.relative(root, qrc), sha256: await hash(qrc) } }
  await fs.writeFile(path.join(output, 'native-bindings.json'), JSON.stringify({ target, electronVersion, abi, binaries, runtimeVerified: false }, null, 2))
  console.log(`Packaged ${target}; runtime validation is a separate step.`)
}
;(async() => { for (const target of targets) await run(target) })().catch(error => { console.error(error); process.exitCode = 1 })
