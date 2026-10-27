const fs = require('node:fs')
const cp = require('node:child_process')
const { unifiedVersion } = require('./release-policy.cjs')
const localImage = 'tuneflow-server-web:ci'
const validDigest = value => /^sha256:[a-f0-9]{64}$/.test(value)

function imageIdentity({ version, source, username }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(source) || typeof username !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(username)) throw Error('Invalid image publication identity')
  return `${username}/tuneflow-server`
}
const docker = (runner, args) => runner.execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const manifest = (runner, name) => JSON.parse(docker(runner, ['buildx', 'imagetools', 'inspect', '--raw', name]))
const digest = (runner, name) => {
  const value = JSON.parse(docker(runner, ['buildx', 'imagetools', 'inspect', name, '--format', '{{json .Manifest.Digest}}']))
  if (!validDigest(value)) throw Error('Invalid published image digest')
  return value
}

function publishImage(identity, runner = cp) {
  const image = imageIdentity(identity)
  const { source, version } = identity
  const local = JSON.parse(docker(runner, ['image', 'inspect', localImage, '--format', '{{json .}}']))
  const labels = local.Config?.Labels
  if (!validDigest(local.Id) || labels?.['org.opencontainers.image.revision'] !== source || labels?.['org.opencontainers.image.version'] !== version) throw Error('Tested image differs from frozen release')
  let existing
  try { existing = manifest(runner, `${image}:${version}`) } catch (error) {
    // An unavailable registry or denied access must never be treated as an absent version.
    if (!/manifest unknown|no such manifest|not found/i.test(String(error.stderr ?? ''))) throw Error('Unable to establish existing image version')
  }
  if (existing && existing.config?.digest !== local.Id) throw Error('Refusing to replace a different version image')
  for (const tag of [version, 'sha-' + source.slice(0, 12)]) {
    docker(runner, ['tag', localImage, `${image}:${tag}`])
    docker(runner, ['push', `${image}:${tag}`])
  }
  if (manifest(runner, `${image}:${version}`).config?.digest !== local.Id) throw Error('Published image verification failed')
  return { version, source, image, digest: digest(runner, `${image}:${version}`), platform: 'linux/amd64' }
}

function promoteImage(publication, identity, runner = cp) {
  const image = imageIdentity(identity)
  if (publication.image !== image || publication.source !== identity.source || publication.version !== identity.version || !validDigest(publication.digest)) throw Error('Image publication evidence differs from release')
  const frozen = `${image}@${publication.digest}`
  if (digest(runner, `${image}:${identity.version}`) !== publication.digest) throw Error('Version image changed before promotion')
  docker(runner, ['pull', frozen])
  docker(runner, ['tag', frozen, `${image}:latest`])
  docker(runner, ['push', `${image}:latest`])
  if (digest(runner, `${image}:latest`) !== publication.digest) throw Error('Latest image verification failed')
}

if (require.main === module) {
  const identity = { version: unifiedVersion(process.cwd()), source: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), username: process.env.DOCKERHUB_USERNAME }
  if (identity.version !== process.env.RELEASE_VERSION || identity.source !== process.env.RELEASE_SOURCE) throw Error('Checkout differs from unified release')
  if (process.argv[2] === 'version') {
    const publication = publishImage(identity)
    fs.writeFileSync('docker-publication.json', JSON.stringify(publication, null, 2) + '\n')
    console.log(`Verified ${publication.image}:${publication.version} ${publication.digest}`)
  } else if (process.argv[2] === 'latest') {
    promoteImage(JSON.parse(fs.readFileSync('docker-publication.json', 'utf8')), identity)
  } else throw Error('Select version or latest publication')
}

module.exports = { publishImage, promoteImage }
