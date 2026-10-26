const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { expectedAssets } = require('../apps/player/scripts/prepare-release.cjs')

const components = ['desktop', 'web', 'android']
const releaseTag = version => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid client release version')
  return 'v' + version
}
const channelPath = channel => {
  if (!['desktop', 'android'].includes(channel)) throw Error('Invalid update channel')
  return 'channels/' + channel + '.json'
}
const assetComponent = name => name.endsWith('.apk') ? 'android' : name.startsWith('Q-music-Web-') ? 'web' : 'desktop'
const compareVersions = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const difference = Number(a.split('.')[i]) - Number(b.split('.')[i])
    if (difference) return difference
  }
  return 0
}
function channelMetadata(current, incoming, source, assets) {
  if (!/^\d+\.\d+\.\d+$/.test(incoming.version) || !/^[a-f0-9]{40}$/.test(source)) throw Error('Invalid channel metadata')
  if (compareVersions(current.version, incoming.version) > 0) return null
  return { ...incoming, repository: 'appdev/TuneFlow', commit: source, assets }
}
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

function publish(directory, env = process.env, runner = cp) {
  if (env.GITHUB_REPOSITORY !== 'appdev/TuneFlow' || env.GH_REPO !== 'appdev/TuneFlow') throw Error('Publish only in TuneFlow')
  const source = runner.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (source !== env.RELEASE_SOURCE) throw Error('Checkout differs from frozen release source')
  const files = prepareAssets(directory, { version: env.RELEASE_VERSION, source, component: env.RELEASE_COMPONENT })
  const tag = releaseTag(env.RELEASE_VERSION)
  const gh = args => runner.execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
  const view = runner.spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft,assets'], { encoding: 'utf8', env })
  let release
  if (view.status === 0) release = JSON.parse(view.stdout)
  else if (!/not found|404/i.test(view.stderr)) throw Error('Unable to read release state')
  if (!release) {
    const mobile = env.RELEASE_COMPONENT === 'android'
    const metadata = require(mobile ? '../apps/android/publish/mobile-version.json' : '../apps/player/publish/version.json')
    if (metadata.version !== env.RELEASE_VERSION || metadata.desc.length < 80) throw Error('Missing matching release notes')
    const notes = path.join(directory, 'release-notes.md')
    fs.writeFileSync(notes, '<!-- qmusic-service-preview -->\n' + metadata.desc + '\n\n源码： https://github.com/appdev/TuneFlow/tree/' + source + '\n各端按需分批提供安装包；以当前附件为准。\n')
    gh(['release', 'create', tag, '--draft', '--prerelease', '--target', source, '--title', 'TuneFlow 客户端 ' + env.RELEASE_VERSION + ' 预览版', '--notes-file', notes])
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
  // Raw/CDN channels advertise only uploaded public releases, never pending source metadata.
  const published = JSON.parse(gh(['api', 'repos/appdev/TuneFlow/releases/tags/' + tag]))
  if (published.draft) throw Error('Cannot advertise a draft release')
  for (const name of files) {
    const asset = published.assets.find(asset => asset.name === name)
    const bytes = fs.readFileSync(path.join(directory, name))
    const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex')
    if (!asset || asset.size !== bytes.length || asset.digest !== digest) throw Error('Published asset verification failed: ' + name)
  }
  const channels = env.RELEASE_COMPONENT === 'all' ? ['desktop', 'android'] : [env.RELEASE_COMPONENT]
  for (const channel of channels) {
    if (channel === 'web') continue
    const apiPath = 'repos/appdev/TuneFlow/contents/' + channelPath(channel)
    const incoming = require(channel === 'android' ? '../apps/android/publish/mobile-version.json' : '../apps/player/publish/version.json')
    let updated = false
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = runner.spawnSync('gh', ['api', apiPath + '?ref=main'], { encoding: 'utf8', env })
      if (result.status !== 0 && !/404|not found/i.test(result.stderr)) throw Error('Unable to read update channel')
      const file = result.status === 0 ? JSON.parse(result.stdout) : null
      const current = file ? JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) : { version: '0.0.0' }
      const metadata = channelMetadata(current, incoming, source, published.assets)
      if (!metadata) { updated = true; break }
      const write = runner.spawnSync('gh', ['api', '--method', 'PUT', apiPath, '--input', '-'], {
        encoding: 'utf8', env,
        input: JSON.stringify({ message: 'chore(update): advertise ' + channel + ' ' + incoming.version, branch: 'main', ...(file ? { sha: file.sha } : {}), content: Buffer.from(JSON.stringify(metadata, null, 2) + '\n').toString('base64') }),
      })
      if (write.status === 0) { updated = true; break }
      if (!/409|422/.test(write.stderr)) throw Error('Unable to update public channel')
    }
    if (!updated) throw Error('Update channel changed concurrently; retry publication')
  }
}
if (require.main === module) publish(process.argv[2])
module.exports = { prepareAssets, assetComponent, channelMetadata, publish, releaseTag, channelPath }
