const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const expectedAssets = version => [
  ...['mac', 'win', 'linux'].flatMap(os => ['arm64', 'x64'].map(arch => `TuneFlow-${version}-${os}-${arch}.${os === 'linux' ? 'tar.gz' : 'zip'}`)),
  `TuneFlow-Web-${version}.tar.gz`,
  ...['arm64-v8a', 'universal'].map(abi => `TuneFlow-Android-${version}-${abi}.apk`),
]

function prepareRelease(directory, metadata) {
  const { version, commit, android, service } = metadata
  if (!/^\d+\.\d+\.\d+$/.test(version) || ![commit, android.commit, service.commit].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw Error('Release requires a version and frozen source commits')
  const expected = expectedAssets(version).sort()
  const generated = ['SHA256SUMS.txt', 'SHA256SUMS-android.txt', 'release-manifest.json']
  const actual = fs.readdirSync(directory).filter(name => !generated.includes(name)).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Incomplete or unexpected release assets: ' + JSON.stringify(actual))
  const assets = expected.map(name => {
    const file = path.join(directory, name)
    if (!fs.lstatSync(file).isFile()) throw Error('Release assets must be regular files')
    const bytes = fs.readFileSync(file)
    const signature = name.endsWith('.tar.gz') ? '1f8b' : '504b'
    if (bytes.length < 4 || bytes.subarray(0, 2).toString('hex') !== signature) throw Error('Invalid archive: ' + name)
    return { name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  })
  const checksums = list => list.map(file => `${file.sha256}  ${file.name}\n`).join('')
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums(assets))
  fs.writeFileSync(path.join(directory, 'SHA256SUMS-android.txt'), checksums(assets.filter(file => file.name.endsWith('.apk'))))
  fs.writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify({ version, channel: 'service-preview', commit, android, service, assets }, null, 2) + '\n')
  return assets
}

if (require.main === module) {
  const pkg = require('../package.json')
  prepareRelease(process.argv[2], {
    version: pkg.version, commit: process.env.GITHUB_SHA,
    android: { commit: require('../publish/mobile-version.json').commit, applicationId: 'io.github.nshpiter.qmusic.mobile.preview', signing: 'existing-preview' },
    service: require('../publish/service-version.json'),
  })
}
module.exports = { expectedAssets, prepareRelease }
