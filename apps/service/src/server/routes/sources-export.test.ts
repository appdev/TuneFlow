import AdmZip from 'adm-zip'
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../app'

const roots: string[] = []
const apps: Array<Awaited<ReturnType<typeof createServer>>> = []

const sourceScript = (name: string, version: string, marker: string) => `/*
 * @name ${name}
 * @version ${version}
 */
window.tuneflow.marker = ${JSON.stringify(marker)}
`

const createTestServer = async() => {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-source-export-route-'))
  const webRoot = path.join(storageRoot, 'web')
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>TuneFlow</title>')
  roots.push(storageRoot)
  const app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
  apps.push(app)
  return { app, storageRoot }
}

afterEach(async() => {
  for (const app of apps.splice(0)) await app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source script ZIP export route', () => {
  it('streams every registered script as a byte-identical root ZIP entry', async() => {
    const { app } = await createTestServer()
    const firstScript = sourceScript('First/Source', '1.0.0', 'first')
    const secondScript = sourceScript('First\\Source', '1.0.0', 'second')
    await app.inject({ method: 'POST', url: '/api/v1/sources', payload: { script: firstScript } })
    await app.inject({ method: 'POST', url: '/api/v1/sources', payload: { script: secondScript } })

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/export' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/zip/)
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="tuneflow-sources-\d{8}-\d{6}\.zip"$/)
    expect(response.headers['cache-control']).toBe('no-store')
    const entries = new AdmZip(response.rawPayload).getEntries()
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => !entry.isDirectory && /^[^/\\]+\.js$/.test(entry.entryName))).toBe(true)
    expect(entries.map(entry => entry.getData().toString('utf8'))).toEqual([firstScript, secondScript])
  })

  it('rejects an empty export with a typed conflict', async() => {
    const { app } = await createTestServer()

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/export' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'SOURCE_EXPORT_EMPTY' } })
  })

  it('fails the complete export without leaking a missing script path', async() => {
    const { app, storageRoot } = await createTestServer()
    const installed = await app.inject({ method: 'POST', url: '/api/v1/sources', payload: { script: sourceScript('Missing', '1', 'missing') } })
    const id = installed.json().data.id as string
    const scriptPath = path.join(storageRoot, 'sources', `${id.slice('user_api_'.length)}.js`)
    unlinkSync(scriptPath)

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/export' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ error: { code: 'SOURCE_EXPORT_FAILED', message: 'Unable to export installed sources' } })
    expect(response.body).not.toContain(storageRoot)
    expect(response.body).not.toContain(scriptPath)
  })
})
