const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

function unifiedVersion(root) {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const applications = ['service', 'player', 'android']
  const version = read('apps/service/package.json').version
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid unified version')
  for (const app of applications) {
    const prefix = `apps/${app}/`
    const pkg = read(prefix + 'package.json')
    const lock = read(prefix + 'package-lock.json')
    if ([pkg.version, lock.version, lock.packages?.['']?.version].some(value => value !== version)) throw Error('Unified version mismatch: ' + app)
  }
  for (const file of ['apps/player/publish/version.json', 'apps/player/publish/mobile-version.json', 'apps/player/publish/service-version.json', 'apps/android/publish/mobile-version.json']) {
    if (read(file).version !== version) throw Error('Unified metadata version mismatch: ' + file)
  }
  for (const file of ['apps/player/publish/version.json', 'apps/android/publish/mobile-version.json']) {
    if ((read(file).desc ?? '').trim().length < 80) throw Error('Missing unified release notes: ' + file)
  }
  if (fs.readFileSync(path.join(root, `apps/service/docs/releases/${version}.md`), 'utf8').trim().length < 80) throw Error('Missing Service release notes')
  return version
}

function releaseIdentity({ version, source, tagSource, ref, repository, publish }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(source)) throw Error('Invalid release identity')
  if (publish && (repository !== 'appdev/TuneFlow' || ref !== 'refs/tags/TuneFlow-v' + version || tagSource !== source)) throw Error('Publication requires the matching TuneFlow tag and frozen source in appdev/TuneFlow')
  return { version, source }
}

if (require.main === module) {
  const version = unifiedVersion(process.cwd())
  const git = args => cp.execFileSync('git', args, { encoding: 'utf8' }).trim()
  const source = git(['rev-parse', 'HEAD'])
  const publish = process.env.PUBLISH === 'true'
  releaseIdentity({ version, source, publish, repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, tagSource: publish ? git(['rev-parse', `refs/tags/TuneFlow-v${version}^{}`]) : undefined })
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nsource=${source}\n`)
  console.log(`Validated unified release ${version} at ${source}`)
}

module.exports = { unifiedVersion, releaseIdentity }
