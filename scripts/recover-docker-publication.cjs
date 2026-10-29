const cp = require('node:child_process')
const fs = require('node:fs')
const { unifiedVersion, releaseIdentity } = require('./release-policy.cjs')
const { publishImage, promoteImage } = require('./publish-image.cjs')

function validateRecovery({ repository, version, currentVersion, source, runId, tagSource, run, jobs }) {
  if (!/^\d+$/.test(runId) || String(run.id) !== runId || currentVersion !== version) throw Error('Recovery version or run differs from current release')
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository || run.path !== '.github/workflows/release.yml' || run.event !== 'workflow_dispatch' || run.head_sha !== source || run.status !== 'completed' || run.conclusion !== 'failure') throw Error('Recovery requires the original failed release run')
  const expected = { metadata: 'success', 'image / docker-build': 'success', clients: 'skipped', publish: 'failure' }
  for (const [name, result] of Object.entries(expected)) {
    const matching = jobs.filter(job => job.name === name)
    if (matching.length !== 1 || matching[0].conclusion !== result) throw Error('Recovery requires verified Docker-only build jobs')
  }
  return releaseIdentity({ repository, version, source, tagSource, ref: 'refs/tags/' + run.head_branch, publish: true })
}

function main() {
  const version = process.env.RELEASE_VERSION
  const source = process.env.RELEASE_SOURCE
  const runId = process.env.ARTIFACT_RUN_ID
  const repository = process.env.GITHUB_REPOSITORY
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '') || !/^\d+$/.test(runId ?? '') || repository !== 'appdev/TuneFlow') throw Error('Invalid recovery inputs')
  const git = args => cp.execFileSync('git', args, { encoding: 'utf8' }).trim()
  const api = path => JSON.parse(cp.execFileSync('gh', ['api', path], { encoding: 'utf8' }))
  const tagSource = git(['rev-parse', `refs/tags/TuneFlow-v${version}^{}`])
  const run = api(`repos/${repository}/actions/runs/${runId}`)
  const jobs = api(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`).jobs
  const identity = { ...validateRecovery({ repository, version, currentVersion: unifiedVersion(process.cwd()), source, runId, tagSource, run, jobs }), username: process.env.DOCKERHUB_USERNAME }
  const frozen = JSON.parse(git(['show', `${source}:apps/service/package.json`]))
  if (frozen.version !== version) throw Error('Frozen Service version differs from recovery')
  if (process.argv[2] === 'verify') {
    console.log(`Verified Docker recovery ${version} from run ${runId} at ${source}`)
  } else if (process.argv[2] === 'publish') {
    const publication = { ...publishImage(identity), artifactRunId: runId, toolingSource: git(['rev-parse', 'HEAD']) }
    fs.writeFileSync('docker-publication.json', JSON.stringify(publication, null, 2) + '\n')
    promoteImage(publication, identity)
    publication.latestVerified = true
    fs.writeFileSync('docker-publication.json', JSON.stringify(publication, null, 2) + '\n')
    console.log(`Recovered ${publication.image}:${version} and latest at ${publication.digest}`)
  } else throw Error('Select verify or publish recovery phase')
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { validateRecovery }
