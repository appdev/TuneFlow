import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../app'

const main = async(): Promise<void> => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'lx-openapi-build-'))
  const webRoot = path.join(temporaryRoot, 'web')
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>LX</title>')
  const app = await createServer({ storageRoot: temporaryRoot, webRoot, host: '127.0.0.1', port: 0 })
  try {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    if (response.statusCode !== 200) throw new Error(`OpenAPI generation failed with HTTP ${response.statusCode}`)
    writeFileSync(path.resolve('dist/server/openapi.json'), `${JSON.stringify(response.json(), null, 2)}\n`)
  } finally {
    await app.close()
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
