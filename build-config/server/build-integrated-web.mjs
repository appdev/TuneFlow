import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const flutterRoot = process.argv[2] && path.resolve(process.argv[2])
if (!flutterRoot || !existsSync(path.join(flutterRoot, 'pubspec.yaml'))) {
  throw new Error('Usage: npm run build:web:integrated -- /absolute/path/to/flutter-client')
}
const dist = path.join(root, 'dist')
mkdirSync(dist, { recursive: true })
const stage = mkdtempSync(path.join(dist, 'web-integrated-stage-'))
execFileSync('flutter', ['build', 'web', '--release', '--base-href', '/', '--no-web-resources-cdn'], { cwd: flutterRoot, stdio: 'inherit' })
cpSync(path.join(flutterRoot, 'build/web'), stage, { recursive: true })
execFileSync('npm', ['run', 'build:web'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TUNEFLOW_LEGACY_WEB_OUTPUT: path.join(stage, 'V2'), TUNEFLOW_LEGACY_WEB_BASE: '/V2/' },
})
const destination = path.join(dist, 'web-integrated')
if (existsSync(destination)) {
  renameSync(destination, `${destination}-backup-${Date.now()}`)
}
renameSync(stage, destination)
console.log(`Integrated Web: ${destination}\nFlutter: /\nLegacy Web: /V2/`)
