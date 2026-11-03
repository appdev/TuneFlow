// Run the maintained client against an isolated, real Service and media fixture.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const service = fileURLToPath(new URL('../../', import.meta.url))
const player = path.resolve(service, '../player')
const proof = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-shared-web-proof-'))
const env = { ...process.env, Q_WEB_ROOT: path.join(service, 'dist/web'), Q_WEB_PROOF: proof }
const fixture = spawn(process.execPath, [path.join(player, 'scripts/web-service-fixture.cjs')], { env, stdio: ['ignore', 'ignore', 'inherit'] })
const exited = new Promise(resolve => fixture.once('exit', resolve))
const stop = () => { fixture.kill('SIGTERM') }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
try {
  const deadline = Date.now() + 30_000
  while (!existsSync(path.join(proof, 'fixture.json'))) {
    if (fixture.exitCode != null || Date.now() > deadline) throw new Error('Shared Web fixture did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const result = spawn(process.execPath, [path.join(player, 'scripts/verify-web-client.cjs')], { env, stdio: 'inherit' })
  const code = await new Promise(resolve => result.once('exit', resolve))
  if (code !== 0) throw new Error(`Shared Web verification failed (${code})`)
  const record = JSON.parse(readFileSync(path.join(proof, 'web-ui.json'), 'utf8'))
  if (!record.passed) throw new Error('Shared Web verification did not pass')
} finally {
  stop()
  await exited
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
  console.log(`Shared Web verification artifacts: ${proof}`)
}
