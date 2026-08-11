import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const serverRoot = path.join(root, 'dist/server')
const nodeProbe = path.join(root, 'build-config/server/probe-node.cjs')
const serviceProbe = path.join(root, 'build-config/server/probe-service.cjs')

if (!existsSync(path.join(serverRoot, 'node_modules/better-sqlite3'))) throw new Error('Service Node dependencies are not prepared')
execFileSync(process.execPath, [nodeProbe], { cwd: serverRoot, stdio: 'inherit' })
execFileSync(process.execPath, [serviceProbe], { cwd: root, stdio: 'inherit' })
