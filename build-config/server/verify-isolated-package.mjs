import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { activateSource, requestLyric } from './isolated-api.mjs'
import { waitForHealth } from './wait-for-health.mjs'

const root = process.cwd()
const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-service-isolated-'))
const fixtureScript = `/*
 * @name Isolated runtime fixture
 * @description Validates the packaged worker without parent dependencies
 * @version 1.0.0
 */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async () => ({ lyric: 'fixture' }))
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`

const listen = async(server) => await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve(server.address().port)
  })
})

const close = async(server) => {
  if (server?.listening) await new Promise(resolve => server.close(resolve))
}

let service
let portServer
try {
  cpSync(path.join(root, 'dist/server'), path.join(isolatedRoot, 'server'), { recursive: true })
  cpSync(path.join(root, 'dist/web'), path.join(isolatedRoot, 'web'), { recursive: true })
  if (!existsSync(path.join(isolatedRoot, 'server/migrate-storage.cjs'))) throw new Error('isolated migration CLI is missing')
  const migrationHelp = spawnSync(process.execPath, ['server/migrate-storage.cjs', '--help'], {
    cwd: isolatedRoot,
    encoding: 'utf8',
  })
  if (migrationHelp.status !== 0 || !migrationHelp.stdout.includes('TuneFlow storage migration')) {
    throw new Error('isolated migration CLI help failed')
  }
  const taglib = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    "import { TagLib } from 'taglib-wasm'; const value = await TagLib.initialize(); if (!value.version()) process.exit(1)",
  ], { cwd: path.join(isolatedRoot, 'server'), stdio: 'inherit' })
  if (taglib.status !== 0) throw new Error('isolated TagLib-Wasm runtime failed')
  portServer = net.createServer()
  const port = await listen(portServer)
  await close(portServer)
  const origin = `http://127.0.0.1:${port}`
  service = spawn(process.execPath, ['server/index.cjs'], {
    cwd: isolatedRoot,
    env: {
      ...process.env,
      TUNEFLOW_HOST: '127.0.0.1',
      TUNEFLOW_PORT: String(port),
      TUNEFLOW_STORAGE_ROOT: path.join(isolatedRoot, 'storage'),
      TUNEFLOW_WEB_ROOT: path.join(isolatedRoot, 'web'),
      TUNEFLOW_SERVICE_NODE_MODULES: path.join(isolatedRoot, 'server/node_modules'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitForHealth(origin)
  const install = await fetch(`${origin}/api/v1/sources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: fixtureScript }),
  })
  if (!install.ok) throw new Error('isolated source install failed')
  const installed = await install.json()
  await activateSource(origin, installed.data.id)
  if (await requestLyric(origin, 'fixture', { id: 'isolated-fixture', source: 'fixture' }) !== 'fixture') throw new Error('isolated worker action failed')
  console.log(JSON.stringify({ isolatedPackage: true, main: true, worker: true, action: true }))
} finally {
  if (service != null && service.exitCode == null) {
    service.kill('SIGTERM')
    await new Promise(resolve => service.once('exit', resolve))
  }
  await close(portServer)
  rmSync(isolatedRoot, { recursive: true, force: true })
}
