const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { expectedAssets } = require('../apps/player/scripts/prepare-release.cjs')

const components = ['desktop', 'web', 'android']
const assetComponent = name => name.endsWith('.apk') ? 'android' : name.startsWith('Q-music-Web-') ? 'web' : 'desktop'
function prepareAssets(directory, { version, source, component }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(source) || !['all', ...components].includes(component)) throw Error('Invalid frozen release inputs')
  const selected = component === 'all' ? components : [component]
  const expected = expectedAssets(version).filter(name => selected.includes(assetComponent(name))).sort()
  const names = fs.readdirSync(directory).filter(name => !/^(?:SHA256SUMS-|manifest-|release-notes)/.test(name)).sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw Error('Incomplete component assets')
  const assets = names.map(name => {
    const file = path.join(directory, name)
    if (!fs.lstatSync(file).isFile()) throw Error('Invalid release file')
    const bytes = fs.readFileSync(file)
    if (bytes.subarray(0, 2).toString('hex') !== (name.endsWith('.tar.gz') ? '1f8b' : '504b')) throw Error('Invalid release archive')
    return { name, size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') }
  })
  const upload = [...names]
  for (const part of selected) {
    const files = assets.filter(asset => assetComponent(asset.name) === part)
    const sumName = 'SHA256SUMS-' + part + '.txt'
    const manifestName = 'manifest-' + part + '.json'
    fs.writeFileSync(path.join(directory, sumName), files.map(asset => asset.digest.slice(7) + '  ' + asset.name + '\n').join(''))
    fs.writeFileSync(path.join(directory, manifestName), JSON.stringify({ version, component: part, repository: 'appdev/TuneFlow', source, assets: files }, null, 2) + '\n')
    upload.push(sumName, manifestName)
  }
  return upload
}

function publish(directory, env = process.env) {
  if (env.GITHUB_REPOSITORY !== 'appdev/Q-music' || env.GH_REPO !== 'appdev/Q-music') throw Error('Use the legacy-channel compatibility caller')
  const source = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (source !== env.RELEASE_SOURCE) throw Error('Checkout differs from frozen release source')
  const files = prepareAssets(directory, { version: env.RELEASE_VERSION, source, component: env.RELEASE_COMPONENT })
  const tag = 'v' + env.RELEASE_VERSION
  const gh = args => cp.execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const view = cp.spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft,assets'], { encoding: 'utf8' })
  let release
  if (view.status === 0) release = JSON.parse(view.stdout)
  else if (!/not found|404/i.test(view.stderr)) throw Error('Unable to read release state')
  if (!release) {
    const mobile = env.RELEASE_COMPONENT === 'android'
    const metadata = require(mobile ? '../apps/android/publish/mobile-version.json' : '../apps/player/publish/version.json')
    if (metadata.version !== env.RELEASE_VERSION || metadata.desc.length < 80) throw Error('Missing matching release notes')
    const notes = path.join(directory, 'release-notes.md')
    fs.writeFileSync(notes, '<!-- qmusic-service-preview -->\n' + metadata.desc + '\n\n源码： https://github.com/appdev/TuneFlow/tree/' + source + '\n各端按需分批提供安装包；以当前附件为准。\n')
    gh(['release', 'create', tag, '--draft', '--prerelease', '--target', env.GITHUB_SHA, '--title', 'Q-music ' + env.RELEASE_VERSION + ' 整合预览版', '--notes-file', notes])
    release = { isDraft: true, assets: [] }
  }
  for (const file of files) {
    const existing = release.assets.find(asset => asset.name === file)
    const bytes = fs.readFileSync(path.join(directory, file))
    const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex')
    if (existing) {
      if (existing.digest !== digest || existing.size !== bytes.length) throw Error('Refusing to replace published asset: ' + file)
      continue
    }
    gh(['release', 'upload', tag, path.join(directory, file)])
  }
  if (release.isDraft) gh(['release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false'])
}
if (require.main === module) publish(process.argv[2])
module.exports = { prepareAssets, assetComponent }
