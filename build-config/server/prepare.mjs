import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const serverRoot = path.join(root, 'dist/server')

if (!existsSync(path.join(serverRoot, 'package.json'))) {
  throw new Error('Build the Service before preparing its runtime dependencies')
}

rmSync(path.join(serverRoot, 'node_modules'), { recursive: true, force: true })
execFileSync('npm', ['install', '--omit=dev', '--package-lock=false', '--no-audit', '--no-fund'], { cwd: serverRoot, stdio: 'inherit' })
execFileSync(process.execPath, [path.join(serverRoot, 'generate-openapi.cjs')], { cwd: root, stdio: 'inherit' })
