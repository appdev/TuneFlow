const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
const proof = path.join(root, 'artifacts/navigation-performance/verification')
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const sources = () => execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(file => file && !/^(migration-plan\.(md|json)|README-service\.md)$/.test(file)).sort()
const records = files => files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))
const identity = entries => hash(entries.map(file => `${file.path}:${file.sha256}`).join('\n'))
const walk = folder => fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`])
fs.mkdirSync(proof, { recursive: true })
if (process.argv[2] === 'freeze') {
  const files = records(sources())
  const dist = records(walk('dist'))
  const frozen = { sourceIdentity: identity(files), distIdentity: identity(dist), files, dist }
  fs.writeFileSync(path.join(proof, 'frozen-source.json'), JSON.stringify(frozen, null, 2))
  console.log({ frozen: true, sourceIdentity: frozen.sourceIdentity, sourceFiles: files.length, distFiles: dist.length })
} else {
  const frozen = JSON.parse(fs.readFileSync(path.join(proof, 'frozen-source.json'), 'utf8'))
  const current = records(sources())
  if (identity(current) !== frozen.sourceIdentity) throw new Error('Source changed after freeze')
  if (identity(records(walk('dist'))) !== frozen.distIdentity) throw new Error('Built output changed after freeze')
  const results = []
  for (const target of process.argv.slice(2)) {
    if (!/^(darwin-(arm64|x64)|win32-(x64|arm64)|linux-(x64|arm64))$/.test(target)) throw new Error('Unsupported target')
    const [platform, arch] = target.split('-')
    const folder = path.join(root, 'artifacts/navigation-performance', target)
    const native = JSON.parse(fs.readFileSync(path.join(folder, 'native-bindings.json'), 'utf8'))
    const unpacked = platform === 'darwin'
      ? path.join(folder, arch === 'arm64' ? 'mac-arm64' : 'mac', 'TuneFlow.app/Contents/Resources')
      : path.join(folder, platform === 'win32' ? arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked' : arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'resources')
    const archive = path.join(unpacked, 'app.asar')
    for (const file of frozen.dist) {
      if (hash(asar.extractFile(archive, file.path)) !== file.sha256) throw new Error(`Packaged output differs: ${target}/${file.path}`)
    }
    for (const [name, file] of Object.entries({ sqlite: 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', qrc: 'build/Release/qrc_decode.node' })) {
      if (hash(asar.extractFile(archive, file)) !== native.binaries[name].sha256) throw new Error(`Packaged native binding differs: ${target}/${name}`)
    }
    const artifacts = fs.readdirSync(folder).filter(name => /\.(zip|tar\.gz)$/.test(name)).map(name => ({ file: path.relative(root, path.join(folder, name)), bytes: fs.statSync(path.join(folder, name)).size, sha256: hash(fs.readFileSync(path.join(folder, name))) }))
    if (artifacts.length !== 1) throw new Error(`Expected one deliverable archive: ${target}`)
    results.push({ target, matchingDistFiles: frozen.dist.length, matchingNativeBindings: 2, electronVersion: native.electronVersion, abi: native.abi, artifacts })
  }
  fs.writeFileSync(path.join(proof, 'package-integrity.json'), JSON.stringify({ sourceIdentity: frozen.sourceIdentity, distIdentity: frozen.distIdentity, results }, null, 2))
  console.log({ frozenSourceMatches: true, verifiedPackages: results.length, targets: results.map(result => result.target) })
}
