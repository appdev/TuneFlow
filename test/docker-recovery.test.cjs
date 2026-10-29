const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validateRecovery } = require('../scripts/recover-docker-publication.cjs')
const source = 'a'.repeat(40)
const repository = 'appdev/TuneFlow'
const fixture = () => ({
  repository, version: '2.13.11', currentVersion: '2.13.11', source, tagSource: source, runId: '123',
  run: { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository }, path: '.github/workflows/release.yml', event: 'workflow_dispatch', head_sha: source, head_branch: 'TuneFlow-v2.13.11', status: 'completed', conclusion: 'failure' },
  jobs: [{ name: 'metadata', conclusion: 'success' }, { name: 'image / docker-build', conclusion: 'success' }, { name: 'clients', conclusion: 'skipped' }, { name: 'publish', conclusion: 'failure' }],
})

test('recovery accepts only the exact tagged source with a previously verified Docker-only artifact', () => {
  assert.deepEqual(validateRecovery(fixture()), { version: '2.13.11', source })
  for (const change of [{ source: 'b'.repeat(40) }, { tagSource: 'b'.repeat(40) }, { runId: '456' }, { currentVersion: '2.13.12' }, { repository: 'other/TuneFlow' }]) assert.throws(() => validateRecovery({ ...fixture(), ...change }))
  for (const change of [{ head_branch: 'main' }, { head_sha: 'b'.repeat(40) }, { status: 'in_progress' }, { conclusion: 'cancelled' }, { path: '.github/workflows/docker-build.yml' }, { event: 'pull_request' }, { head_repository: { full_name: 'fork/TuneFlow' } }]) {
    const value = fixture(); Object.assign(value.run, change); assert.throws(() => validateRecovery(value))
  }
  for (let index = 0; index < 4; index++) {
    const value = fixture(); value.jobs[index].conclusion = 'cancelled'; assert.throws(() => validateRecovery(value))
  }
  const clients = fixture(); clients.jobs[2].conclusion = 'success'; assert.throws(() => validateRecovery(clients))
})

test('recovery checks the original run before credentials and never rebuilds or publishes clients', () => {
  const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/recover-docker-publication.yml'), 'utf8')
  assert.doesNotMatch(source, /build-push-action|docker build |publish-client|channels\//)
  assert.ok(source.indexOf('recover-docker-publication.cjs verify') < source.indexOf('docker/login-action'))
  assert.ok(source.indexOf('docker load --input') < source.indexOf('recover-docker-publication.cjs publish'))
  assert.match(source, /group: tuneflow-unified-release/)
  assert.match(source, /gh run download "\$ARTIFACT_RUN_ID"/)
})
