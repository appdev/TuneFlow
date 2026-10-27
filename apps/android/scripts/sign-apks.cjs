const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

function signApks(directory) {
  for (const name of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_HOME']) {
    if (!process.env[name]) throw new Error(`Missing ${name}`)
  }
  const apks = fs.readdirSync(directory).filter(name => name.endsWith('.apk')).sort()
  if (!apks.length) throw new Error('No Android packages to sign')
  const tools = path.join(process.env.ANDROID_HOME, 'build-tools', '35.0.0')
  const apksigner = path.join(tools, 'apksigner')
  const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool'
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneflow-signing-'))
  fs.chmodSync(temporary, 0o700)
  const keystore = path.join(temporary, 'TuneFlow.jks')
  const run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    fs.writeFileSync(keystore, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'), { mode: 0o600 })
    const certificate = run(keytool, ['-exportcert', '-keystore', keystore, '-alias', process.env.ANDROID_KEY_ALIAS, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'])
    const expected = crypto.createHash('sha256').update(certificate).digest('hex')
    for (const name of apks) {
      const apk = path.join(directory, name)
      run(apksigner, ['sign', '--ks', keystore, '--ks-key-alias', process.env.ANDROID_KEY_ALIAS, '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD', apk])
      const verification = run(apksigner, ['verify', '--print-certs', apk]).toString()
      const actual = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i.exec(verification)?.[1].toLowerCase()
      if (actual !== expected) throw new Error('APK signing certificate does not match the configured keystore')
      console.log(`Signed and verified ${name}`)
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    signApks(process.argv[2] || 'android/app/build/outputs/apk/standalone')
  } catch (error) {
    // Child-process errors can contain their environment; never log the error object.
    console.error(error.status == null ? error.message : `Android signing tool failed (exit ${error.status})`)
    process.exitCode = 1
  }
}

module.exports = { signApks }
