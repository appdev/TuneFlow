import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateIntegratedWeb } from './install-integrated-web.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

export const buildIntegratedDocker = (args, { run = execFileSync, serviceRoot = root } = {}) => {
  const reuseWeb = args.length === 1 && args[0] === '--skip-web-build'
  const flutterRoot = args.length === 1 && !args[0].startsWith('--') ? path.resolve(args[0]) : undefined
  if (!reuseWeb && (!flutterRoot || !existsSync(path.join(flutterRoot, 'pubspec.yaml')))) {
    throw new Error('Usage: npm run build:docker:integrated -- /path/to/flutter-client (or --skip-web-build for existing dist/web-integrated)')
  }
  if (reuseWeb) validateIntegratedWeb(path.join(serviceRoot, 'dist/web-integrated'))
  const options = { cwd: serviceRoot, stdio: 'inherit' }
  // Check the daemon before doing an expensive Flutter/Vue compilation.
  run('docker', ['info', '--format', '{{.ServerVersion}}'], options)
  run('docker', ['compose', 'version'], options)
  if (!reuseWeb) run('npm', ['run', 'build:web:integrated', '--', flutterRoot], options)
  validateIntegratedWeb(path.join(serviceRoot, 'dist/web-integrated'))
  run('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.integrated.yaml', 'build', 'tuneflow-web'], options)
  console.log('Integrated image built. No containers were started or replaced.\nTo start: docker compose -f compose.yaml -f compose.integrated.yaml up -d --no-build\nFlutter: /  Legacy Web: /V2/  API: /api/v1/')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    buildIntegratedDocker(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
