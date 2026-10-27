const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const vm = require('node:vm')
const ts = require('../apps/player/node_modules/typescript')
const { publish, prepareAssets, releaseTag, channelPath } = require('../scripts/publish-client.cjs')
const { expectedAssets } = require('../apps/player/scripts/prepare-release.cjs')
const source = 'a'.repeat(40)
const version = require('../apps/player/package.json').version

test('release contains TuneFlow packages and exactly arm64 plus universal Android', () => {
  const names = expectedAssets(version)
  assert.equal(names.length, 8)
  assert.ok(names.every(name => !name.startsWith('TuneFlow-Web-')))
  assert.ok(names.every(name => name.startsWith('TuneFlow-') && !/Q.?music/i.test(name)))
  assert.deepEqual(names.filter(name => name.endsWith('.apk')), [
    `TuneFlow-Android-${version}-arm64-v8a.apk`,
    `TuneFlow-Android-${version}-universal.apk`,
  ])
})

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-publication-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const name of expectedAssets(version)) fs.writeFileSync(path.join(dir, name), Buffer.from(name.endsWith('.gz') ? '1f8b0000' : '504b0304', 'hex'))
  const events = [], writes = []
  const state = { draft: true, assets: [] }
  const env = { ...process.env, GITHUB_REPOSITORY: 'appdev/TuneFlow', GH_REPO: 'appdev/TuneFlow', RELEASE_SOURCE: source, RELEASE_VERSION: version, RELEASE_COMPONENT: 'all', GITHUB_SHA: 'b'.repeat(40) }
  const runner = {
    execFileSync(command, args) {
      if (command === 'git') return source
      assert.equal(command, 'gh')
      events.push(args)
      if (args[0] === 'release' && args[1] === 'create') assert.equal(args[args.indexOf('--target') + 1], source)
      if (args[0] === 'release' && args[1] === 'upload') {
        const file = args[3], bytes = fs.readFileSync(file)
        state.assets.push({ name: path.basename(file), size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') })
      }
      if (args[0] === 'release' && args[1] === 'edit') state.draft = !!options.keepDraft
      if (args[0] === 'api') {
        assert.equal(args[1], 'repos/appdev/TuneFlow/releases/tags/TuneFlow-v' + version)
        return JSON.stringify({ ...state, assets: options.missingAsset ? state.assets.slice(1) : state.assets })
      }
      return ''
    },
    spawnSync(command, args, opts) {
      assert.equal(command, 'gh')
      if (args[0] === 'release') return { status: 1, stderr: '404 not found' }
      if (args.includes('PUT')) {
        assert.equal(state.draft, false)
        assert.equal(state.assets.length, 12)
        const body = JSON.parse(opts.input)
        assert.equal(body.branch, 'main')
        writes.push({ api: args[3], body, metadata: JSON.parse(Buffer.from(body.content, 'base64')) })
        return { status: 0 }
      }
      assert.match(args[1], /^repos\/appdev\/TuneFlow\/contents\/channels\/(desktop|android)\.json\?ref=main$/)
      if (options.channelError) return { status: 1, stderr: '403 Forbidden' }
      if (options.newerChannel) return { status: 0, stdout: JSON.stringify({ sha: 'file-sha', content: Buffer.from(JSON.stringify({ version: '99.0.0' })).toString('base64') }) }
      return { status: 1, stderr: '404 not found' }
    },
  }
  return { dir, env, runner, events, writes }
}

test('TuneFlow publishes a frozen client tag and creates channels only after verifying every public asset', t => {
  const f = fixture(t)
  publish(f.dir, f.env, f.runner)
  assert.equal(f.writes.length, 2)
  assert.deepEqual(f.writes.map(w => w.api), ['repos/appdev/TuneFlow/contents/channels/desktop.json', 'repos/appdev/TuneFlow/contents/channels/android.json'])
  for (const w of f.writes) {
    assert.equal(w.metadata.version, version)
    assert.equal(w.metadata.commit, source)
    assert.equal(w.metadata.assets.length, 12)
    assert.equal(w.body.sha, undefined)
  }
  assert.equal(releaseTag(version), 'TuneFlow-v' + version)
  assert.equal(channelPath('android'), 'channels/android.json')
  assert.throws(() => channelPath('service'))
  assert.throws(() => releaseTag('../bad'))
})

test('drafts, incomplete public assets and permission errors cannot advertise an update', t => {
  for (const [options, message] of [[{ keepDraft: true }, /draft/], [{ missingAsset: true }, /verification failed/], [{ channelError: true }, /read update channel/]]) {
    const f = fixture(t, options)
    assert.throws(() => publish(f.dir, f.env, f.runner), message)
    assert.equal(f.writes.length, 0)
  }
})

test('standalone Web cannot be selected or included in future client publication', t => {
  const f = fixture(t)
  assert.throws(() => prepareAssets(f.dir, { version, source, component: 'web' }), /Invalid frozen release inputs/)
  fs.writeFileSync(path.join(f.dir, `TuneFlow-Web-${version}.tar.gz`), Buffer.from('1f8b0000', 'hex'))
  assert.throws(() => publish(f.dir, f.env, f.runner), /Incomplete component assets/)
  assert.equal(f.events.length, 0)
  assert.equal(f.writes.length, 0)
})

test('incomplete builds, another repository and newer channels are protected', t => {
  const f = fixture(t)
  assert.throws(() => publish(f.dir, { ...f.env, GH_REPO: 'appdev/Q-music' }, f.runner), /only in TuneFlow/)
  fs.unlinkSync(path.join(f.dir, expectedAssets(version)[0]))
  assert.throws(() => publish(f.dir, f.env, f.runner), /Incomplete/)
  assert.equal(f.events.length, 0)
  const newer = fixture(t, { newerChannel: true })
  publish(newer.dir, newer.env, newer.runner)
  assert.equal(newer.writes.length, 0)
})

function updater(file) {
  const context = { exports: {}, require: () => ({ baseUrl: '' }) }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, context)
  return context.exports
}

test('desktop and Android select their own public client release, excluding Server, Web, drafts and pending metadata', async() => {
  const files = ['apps/player/src/common/utils/updateSources.ts', 'apps/android/src/utils/updateSources.ts']
  assert.equal(fs.readFileSync(path.join(__dirname, '..', files[0]), 'utf8'), fs.readFileSync(path.join(__dirname, '..', files[1]), 'utf8'))
  for (const file of files) {
    const api = updater(file)
    for (const platform of ['desktop', 'android']) {
      const requests = []
      const info = await api.getUpdateVersion(async url => {
        requests.push(url)
        assert.ok(url.includes('appdev/TuneFlow'))
        assert.ok(!url.includes('/publish/'))
        if (!url.includes('api.github')) return { version: '99.0.0' }
        return [
          { tag_name: 'v99.0.0', assets: [{ name: 'release-manifest.json' }] },
          { tag_name: 'v98.0.0', assets: [{ name: 'latest.yml' }] },
          { tag_name: 'TuneFlow-v9.0.0', draft: true, assets: [{ name: 'TuneFlow-9.0.0-mac-arm64.zip' }] },
          { tag_name: 'TuneFlow-v8.0.0', assets: [{ name: 'TuneFlow-Web-8.0.0.tar.gz' }] },
          { tag_name: 'TuneFlow-v0.4.26', prerelease: true, body: '<!-- tuneflow-service-preview -->', assets: [{ name: 'TuneFlow-Android-0.4.26-arm64-v8a.apk' }] },
          { tag_name: 'TuneFlow-v0.4.25', prerelease: true, body: '<!-- tuneflow-service-preview -->', assets: [{ name: 'TuneFlow-0.4.25-linux-arm64.tar.gz' }] },
        ]
      }, platform)
      assert.equal(info.version, platform === 'android' ? '0.4.26' : '0.4.25')
      assert.equal(requests.length, 5)
      const fallback = await api.getUpdateVersion(async url => {
        if (url.includes('api.github')) throw Error('offline')
        assert.ok(url.includes('/channels/' + platform + '.json'))
        return { version: '0.4.25' }
      }, platform)
      assert.equal(fallback.version, '0.4.25')
      assert.match(api.assetUrl('0.4.25', 'SHA256SUMS-android.txt'), /TuneFlow\/releases\/download\/TuneFlow-v0\.4\.25\//)
      assert.throws(() => api.downloadUrl({ prefix: '' }, 'https://github.com/appdev/Q-music/releases/download/v0.4.25/test.apk'))
    }
  }
})
