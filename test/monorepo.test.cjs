const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
test('import preserves both client histories and tracked preview signing identity', () => {
  for (const sha of ['50de9ca4de2accae30018d6a9f0c11248f710bd3', '8f85b4c42be214b8ab703b85dac5a9a72995f193']) cp.execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root })
  const git = ref => cp.execFileSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' }).trim()
  assert.equal(git('HEAD:apps/android/android/app/debug.keystore'), git('8f85b4c42be214b8ab703b85dac5a9a72995f193:android/app/debug.keystore'))
})
test('application identities, data keys and existing update channel remain compatible', () => {
  assert.match(read('apps/player/scripts/pack-service.cjs'), /appId: 'io.github.qmusic.docker.preview'/)
  assert.match(read('apps/player/src/common/servicePreview.ts'), /SERVICE_PROFILE = 'q-music-docker-preview'/)
  assert.match(read('apps/player/src/renderer/service/workspace.ts'), /PROFILE_KEY = 'qmusic.docker.endpoint.v1'/)
  assert.match(read('apps/android/src/service/workspace.ts'), /PROFILE_KEY = 'qmusic.service.endpoint.v1'/)
  const gradle = read('apps/android/android/app/build.gradle')
  assert.match(gradle, /applicationId "io.github.nshpiter.qmusic.mobile"/)
  assert.match(gradle, /applicationIdSuffix ".preview"/)
  assert.match(gradle, /signingConfig signingConfigs.debug/)
  for (const file of ['apps/player/src/common/utils/updateSources.ts', 'apps/android/src/utils/updateSources.ts']) assert.match(read(file), /https:\/\/github.com\/appdev\/TuneFlow\/releases\/download\//)
})
test('both client facades point to the same portable API and business implementations', () => {
  for (const [app, dir] of [['player', 'src/renderer/service'], ['android', 'src/service']]) {
    for (const name of ['client', 'downloads', 'recommendations', 'accountLibrary']) {
      const file = path.join(root, 'apps', app, dir, name + '.ts')
      const match = /(?:^|\n)export \* from '([^']+)'/.exec(fs.readFileSync(file, 'utf8'))
      assert.ok(match)
      assert.equal(path.resolve(path.dirname(file), match[1] + '.ts'), path.join(root, 'packages', name === 'client' ? 'service-client' : 'music-core', 'src', name + '.ts'))
    }
  }
  for (const dir of ['service-client', 'music-core']) for (const name of fs.readdirSync(path.join(root, 'packages', dir, 'src'))) {
    assert.doesNotMatch(read('packages/' + dir + '/src/' + name), /from ['"](?:vue|react|react-native|electron|@renderer|@\/)/)
  }
})
test('Docker defaults to shared Web and keeps the original volume contract and isolated Service dependencies', () => {
  assert.match(read('Dockerfile'), /ARG TUNEFLOW_WEB_VARIANT=qmusic/)
  for (const source of ['apps/service/**', 'apps/player/**', 'packages/**']) assert.ok(read('.github/workflows/docker-build.yml').includes(source), 'Docker checks must follow every image source')
  assert.match(read('Dockerfile'), /COPY apps\/service\//)
  assert.match(read('compose.yaml'), /tuneflow-config:\/config/)
  assert.match(read('compose.yaml'), /TUNEFLOW_MUSIC_DIR:-\.\/music/)
  assert.equal(JSON.parse(read('package.json')).workspaces, undefined)
  assert.notEqual(JSON.parse(read('apps/service/package.json')).dependencies['better-sqlite3'], JSON.parse(read('apps/player/package.json')).dependencies['better-sqlite3'])
})
test('release jobs use one resolved source and retain API/raw/CDN update compatibility without downgrading', () => {
  const workflow = read('.github/workflows/release-client.yml')
  assert.equal((workflow.match(/ref: \$\{\{ needs.metadata.outputs.source \}\}/g) ?? []).length, 3)
  assert.match(workflow, /options: \[all, desktop, android\]/)
  assert.doesNotMatch(workflow, /^  web:|tuneflow-release-web|TuneFlow-Web-/m)
  assert.doesNotMatch(workflow, /\n  publish:|GH_TOKEN/)
  const { channelMetadata } = require('../scripts/publish-client.cjs')
  const incoming = { version: '0.4.25', desc: 'published preview', history: [] }
  const assets = [{ name: 'Q-music-android-v0.4.25-arm64-v8a.apk' }]
  const value = channelMetadata({ version: '0.4.24' }, incoming, 'a'.repeat(40), assets)
  assert.equal(value.repository, 'appdev/TuneFlow')
  assert.equal(value.commit, 'a'.repeat(40))
  assert.deepEqual(value.assets, assets)
  assert.equal(channelMetadata({ version: '0.4.26' }, incoming, 'a'.repeat(40), assets), null)
})
test('component bundles validate independently while preserving APK checksum filenames', t => {
  const { expectedAssets } = require('../apps/player/scripts/prepare-release.cjs')
  const { prepareAssets, assetComponent } = require('../scripts/publish-client.cjs')
  for (const component of ['all', 'desktop', 'android']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-release-component-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const metadata = { version: '0.4.24', source: 'a'.repeat(40), component }
    assert.throws(() => prepareAssets(dir, metadata), /Incomplete/)
    for (const name of expectedAssets(metadata.version).filter(name => component === 'all' || assetComponent(name) === component)) fs.writeFileSync(path.join(dir, name), Buffer.from(name.endsWith('.tar.gz') ? '1f8b0000' : '504b0304', 'hex'))
    const files = prepareAssets(dir, metadata)
    assert.ok(files.includes('manifest-' + (component === 'all' ? 'desktop' : component) + '.json'))
    if (component === 'android' || component === 'all') assert.ok(files.includes('SHA256SUMS-android.txt'))
  }
})
