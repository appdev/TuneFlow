import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../app'

const roots: string[] = []
const apps: Array<Awaited<ReturnType<typeof createServer>>> = []

afterEach(async() => {
  for (const app of apps.splice(0)) await app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Service OpenAPI contract', () => {
  it('documents the complete API with stable, unique operation ids', async() => {
    const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'lx-openapi-'))
    const webRoot = path.join(storageRoot, 'web')
    mkdirSync(webRoot)
    writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>LX</title>')
    roots.push(storageRoot)
    const app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(response.statusCode).toBe(200)
    const document = response.json()
    expect(document.openapi).toBe('3.0.3')
    expect(document.paths['/api/v1/health'].get.operationId).toBe('getHealth')
    const expectedPaths = [
      '/openapi.json', '/api/v1/health', '/api/v1/capabilities', '/api/v1/runtime', '/api/v1/client-data/{key}', '/api/v1/settings',
      '/api/v1/playlists', '/api/v1/playlists/{id}', '/api/v1/playlists/{id}/tracks', '/api/v1/playlists/{id}/tracks/remove',
      '/api/v1/playlists/reorder', '/api/v1/playlists/tracks/move', '/api/v1/playlists/{id}/tracks/reorder', '/api/v1/playlists/import',
      '/api/v1/playlists/{id}/tracks/{trackId}/exists', '/api/v1/tracks/{id}/playlists', '/api/v1/events/snapshot', '/api/v1/events',
      '/api/v1/sources', '/api/v1/sources/active', '/api/v1/sources/{id}', '/api/v1/catalog/capabilities', '/api/v1/catalog/tracks/search',
      '/api/v1/catalog/playlists/search', '/api/v1/catalog/albums/search', '/api/v1/catalog/tracks/lyrics',
      '/api/v1/catalog/tracks/picture', '/api/v1/playback/tracks/resolve', '/api/v1/streams/{token}', '/api/v1/downloads',
      '/api/v1/downloads/{id}/start', '/api/v1/downloads/{id}/resume', '/api/v1/downloads/{id}/pause', '/api/v1/downloads/{id}',
      '/api/v1/library/tracks', '/api/v1/library/scan', '/api/v1/library/tracks/{id}/stream',
    ]
    expect(Object.keys(document.paths).sort()).toEqual(expectedPaths.sort())
    expect(JSON.stringify(document.paths)).not.toMatch(/\/api\/v1\/(?:lists|search|lyrics|stream\/|playback\/resolve|library\{)/)
    const successDataSchema = (pathName: string, method = 'post') => document.paths[pathName][method].responses['200'].content['application/json'].schema.properties.data
    expect(successDataSchema('/api/v1/catalog/tracks/search').properties.list.items.required).toEqual(expect.arrayContaining(['id', 'songmid', 'name', 'singer', 'source', 'interval']))
    expect(successDataSchema('/api/v1/catalog/playlists/search').properties.list.items.required).toEqual(expect.arrayContaining(['id', 'kind', 'name', 'source']))
    expect(successDataSchema('/api/v1/catalog/tracks/lyrics').required).toContain('lyric')
    const downloadItem = successDataSchema('/api/v1/downloads', 'get').items
    expect(downloadItem.required).toEqual(expect.arrayContaining(['queuePosition', 'createdAt', 'updatedAt']))
    const operationIds = new Set<string>()
    for (const pathItem of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
        expect(operation.operationId).toBeTypeOf('string')
        expect(operation.tags).toBeInstanceOf(Array)
        expect(operation.summary).toBeTypeOf('string')
        expect(operationIds.has(operation.operationId), operation.operationId).toBe(false)
        operationIds.add(operation.operationId)
      }
    }
  })
})
