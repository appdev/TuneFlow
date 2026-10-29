const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { unifiedVersion, releaseIdentity } = require('../scripts/release-policy.cjs')
const { publishImage, promoteImage } = require('../scripts/publish-image.cjs')
const source = 'a'.repeat(40)
const version = '2.13.9'
const hash = 'sha256:' + 'b'.repeat(64)
const id = 'sha256:' + 'c'.repeat(64)

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-unified-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, value) => { const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, JSON.stringify(value)) }
  for (const app of ['service', 'player', 'android']) {
    write(`apps/${app}/package.json`, { version })
    write(`apps/${app}/package-lock.json`, { version, packages: { '': { version } } })
  }
  for (const file of ['apps/player/publish/version.json', 'apps/player/publish/mobile-version.json', 'apps/player/publish/service-version.json', 'apps/android/publish/mobile-version.json']) write(file, { version, desc: 'Release notes. '.repeat(10) })
  write(`apps/service/docs/releases/${version}.md`, 'Service notes. '.repeat(10))
  return { root, write }
}

test('unified release rejects divergent app, lock and metadata versions before building', t => {
  for (const file of ['apps/service/package.json', 'apps/player/package.json', 'apps/android/package.json', 'apps/android/package-lock.json', 'apps/player/publish/mobile-version.json', 'apps/player/publish/service-version.json', 'apps/android/publish/mobile-version.json']) {
    const f = fixture(t)
    assert.equal(unifiedVersion(f.root), version)
    f.write(file, { version: '0.4.27' })
    assert.throws(() => unifiedVersion(f.root))
  }
})

test('publication requires the unified tag at the exact source and repository, dry builds do not', () => {
  const identity = { version, source, tagSource: source, ref: 'refs/tags/TuneFlow-v' + version, repository: 'appdev/TuneFlow', publish: true }
  assert.deepEqual(releaseIdentity(identity), { version, source })
  for (const change of [{ tagSource: 'd'.repeat(40) }, { ref: 'refs/heads/main' }, { repository: 'other/TuneFlow' }, { ref: 'refs/tags/v' + version }]) assert.throws(() => releaseIdentity({ ...identity, ...change }))
  assert.deepEqual(releaseIdentity({ version, source, publish: false }), { version, source })
})

function dockerFixture(options = {}) {
  const calls = []
  let pushed = false
  return { calls, runner: { execFileSync(command, args) {
    assert.equal(command, 'docker'); calls.push(args)
    if (args[0] === 'image') return JSON.stringify({ Id: options.containerd ? hash : id, Config: { Labels: { 'org.opencontainers.image.revision': options.wrongSource ? 'd'.repeat(40) : source, 'org.opencontainers.image.version': version } } })
    if (args.includes('--raw')) {
      if (!pushed && options.offline) throw Object.assign(Error('registry error'), { stderr: 'TLS timeout' })
      if (!pushed && !options.existing) throw Object.assign(Error('absent'), { stderr: 'manifest unknown' })
      return JSON.stringify({ config: { digest: options.existing === 'different' ? 'sha256:' + 'e'.repeat(64) : id } })
    }
    if (args[0] === 'buildx') return JSON.stringify(options.existing === 'different' && !pushed ? 'sha256:' + 'd'.repeat(64) : hash)
    if (args[0] === 'push') pushed = true
    return ''
  } } }
}
const identity = { version, source, username: 'apkdv' }

test('only tested frozen images are published; registry errors and differing existing versions stop writes', () => {
  for (const username of [undefined, '', '../other', 'owner/token']) {
    const f = dockerFixture()
    assert.throws(() => publishImage({ ...identity, username }, f.runner))
    assert.equal(f.calls.length, 0)
  }
  for (const options of [{ wrongSource: true }, { offline: true }, { existing: 'different' }, { containerd: true, existing: 'different' }]) {
    const f = dockerFixture(options)
    assert.throws(() => publishImage(identity, f.runner))
    assert.ok(!f.calls.some(args => args[0] === 'push'))
  }
  for (const options of [{}, { existing: 'same' }, { containerd: true }, { containerd: true, existing: 'same' }]) {
    const f = dockerFixture(options)
    const result = publishImage(identity, f.runner)
    assert.equal(result.digest, hash)
    assert.equal(f.calls.filter(args => args[0] === 'push').length, 2)
    assert.ok(!f.calls.flat().some(arg => arg.endsWith(':latest')))
    promoteImage(result, identity, f.runner)
    assert.ok(f.calls.some(args => args[0] === 'push' && args[1].endsWith(':latest')))
    assert.throws(() => promoteImage({ ...result, source: 'd'.repeat(40) }, identity, f.runner))
  }
})

test('the unified workflow builds before publication and latest follows the selected client publication', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8')
  const clients = read('release-client.yml'), image = read('docker-build.yml'), release = read('release.yml')
  for (const build of [clients, image]) assert.doesNotMatch(build, /GH_TOKEN|docker\/login-action|name: Push Docker image|publish_release|\n  publish:/)
  assert.match(release, /needs: \[metadata, clients, image\]/)
  assert.match(release, /component: all/)
  assert.match(release, /export_image: true/)
  assert.ok(release.indexOf('publish-image.cjs version') < release.indexOf('publish-client.cjs release-assets'))
  assert.ok(release.indexOf('publish-client.cjs release-assets') < release.indexOf('publish-image.cjs latest'))
  assert.doesNotMatch(release, /push:\s*\n|tuneflow-release-web|component: web/)
  assert.match(image, /org.opencontainers.image.revision=\$\{\{ steps.source.outputs.source \}\}/)
})

test('Docker-only publication requires a successful image and explicitly skipped clients', () => {
  const release = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8')
  assert.match(release, /docker_only:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/)
  assert.match(release, /clients:\n\s+if: \$\{\{ !inputs.docker_only \}\}/)
  assert.match(release, /needs.metadata.result == 'success' && needs.image.result == 'success'/)
  assert.match(release, /needs.clients.result == 'success' \|\| \(inputs.docker_only && needs.clients.result == 'skipped'\)/)
  for (const step of ['Validate all client packages before publishing anything', 'Publish all client packages and update channels']) {
    assert.ok(release.includes(`name: ${step}\n        if: \${{ !inputs.docker_only }}`))
  }
  assert.match(release, /uses: actions\/download-artifact@v7\n\s+if: \$\{\{ !inputs.docker_only \}\}\n\s+with:\n\s+pattern: tuneflow-release-/)
})
