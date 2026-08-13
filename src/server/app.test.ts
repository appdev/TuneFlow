import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import defaultSetting from '../common/defaultSetting'
import { getDB } from './db/core/db'
import { createServer } from './app'
import { dateFormat2 } from './tuneFlowSdk/rendererUtilsShim'

process.env.TUNEFLOW_SERVICE_NODE_MODULES = path.join(process.cwd(), 'dist/server/node_modules')

const roots: string[] = []
const apps: Array<Awaited<ReturnType<typeof createServer>>> = []

const createTestServer = async() => {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-service-'))
  const webRoot = path.join(storageRoot, 'web')
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>TuneFlow · 音流</title>')
  roots.push(storageRoot)
  const app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
  apps.push(app)
  return { app, storageRoot, webRoot }
}

afterEach(async() => {
  for (const app of apps.splice(0)) await app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('TuneFlow service', () => {
  it('exposes health, capabilities, and server-safe default settings', async() => {
    const { app, storageRoot } = await createTestServer()

    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).json()).toEqual({ data: { status: 'ok' } })
    expect((await app.inject({ method: 'GET', url: '/api/v1/capabilities' })).json()).toMatchObject({
      data: { runtime: 'service', apiVersion: 'v1', features: { settings: true, playback: true, library: true } },
    })
    const settings = (await app.inject({ method: 'GET', url: '/api/v1/settings' })).json()
    expect(settings.data['theme.id']).toBe(defaultSetting['theme.id'])
    expect(settings.data['download.savePath']).toBe(path.join(realpathSync(storageRoot), 'audio'))
    expect(settings.data['desktopLyric.enable']).toBe(false)
  })

  it('persists settings across a server restart', async() => {
    const { app, storageRoot, webRoot } = await createTestServer()
    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'player.volume': 0.35, 'player.autoDownloadOnPlay': true } })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().data['player.volume']).toBe(0.35)
    expect(patched.json().data['player.autoDownloadOnPlay']).toBe(true)
    await app.close()
    apps.splice(apps.indexOf(app), 1)

    const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(restarted)
    expect((await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['player.volume']).toBe(0.35)
    expect((await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['player.autoDownloadOnPlay']).toBe(true)
  })

  it('migrates legacy branded setting keys without losing their values', async() => {
    const { app, storageRoot, webRoot } = await createTestServer()
    const insert = getDB().prepare('INSERT INTO web_settings (key, value) VALUES (?, ?)')
    const legacyMarker = ['L', 'x'].join('')
    insert.run(`player.isPlay${legacyMarker}lrc`, JSON.stringify(false))
    insert.run(`download.isDownload${legacyMarker}Lrc`, JSON.stringify(false))
    insert.run(`download.isEmbedLyric${legacyMarker}`, JSON.stringify(false))
    await app.close()
    apps.splice(apps.indexOf(app), 1)

    const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(restarted)
    const settings = (await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data
    expect(settings['player.isPlayVerbatimLyric']).toBe(false)
    expect(settings['download.isDownloadVerbatimLyric']).toBe(false)
    expect(settings['download.isEmbedVerbatimLyric']).toBe(false)
    expect(getDB().prepare('SELECT key FROM web_settings').all()).toEqual(expect.not.arrayContaining([
      { key: `player.isPlay${legacyMarker}lrc` },
      { key: `download.isDownload${legacyMarker}Lrc` },
      { key: `download.isEmbedLyric${legacyMarker}` },
    ]))
  })

  it('projects legacy download paths to the Service audio root and rejects their updates atomically', async() => {
    const { app, storageRoot, webRoot } = await createTestServer()
    getDB().prepare('INSERT INTO web_settings (key, value) VALUES (?, ?)').run(
      'download.savePath',
      JSON.stringify(path.join(storageRoot, 'legacy-downloads')),
    )
    await app.close()
    apps.splice(apps.indexOf(app), 1)

    const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(restarted)
    expect((await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['download.savePath'])
      .toBe(path.join(realpathSync(storageRoot), 'audio'))

    const volumeBefore = (await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['player.volume']
    expect((await restarted.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'download.savePath': path.join(storageRoot, 'other'), 'player.volume': 0.35 },
    })).json()).toEqual({
      error: { code: 'IMMUTABLE_SETTING', message: 'Download path is managed by the Service' },
    })
    expect((await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['player.volume']).toBe(volumeBefore)
  })

  it('keeps provider relative dates aligned with the renderer language setting', async() => {
    const { app } = await createTestServer()
    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'common.langId': 'zh-cn' } })
    expect(patched.statusCode).toBe(200)
    expect(dateFormat2(Date.now() - 60_000)).toBe('1 分钟前')
  })

  it('persists renderer app data and exposes Web environment and event snapshots', async() => {
    const { app } = await createTestServer()

    expect((await app.inject({ method: 'GET', url: '/api/v1/runtime' })).json()).toEqual({
      data: { cmdParams: {}, deeplink: null },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/client-data/viewPrevState' })).json()).toEqual({ data: null })
    expect((await app.inject({
      method: 'PUT',
      url: '/api/v1/client-data/viewPrevState',
      payload: { value: { url: '/search', query: { text: 'jazz' } } },
    })).json()).toEqual({ data: { url: '/search', query: { text: 'jazz' } } })
    expect((await app.inject({ method: 'GET', url: '/api/v1/client-data/viewPrevState' })).json()).toEqual({
      data: { url: '/search', query: { text: 'jazz' } },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/events/snapshot' })).json()).toEqual({
      data: { sequence: 1, events: [{ type: 'downloads.updated', data: [], sequence: 1 }] },
    })
  })

  it('records Service-timestamped playback metadata and lists it newest first', async() => {
    const { app } = await createTestServer()
    const track = {
      id: 'song-1',
      source: 'kw',
      name: 'Night Wind',
      singer: 'Artist',
      providerOnly: { albumId: 'album-1' },
    }
    const before = Date.now()

    const recorded = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/history',
      payload: { track },
    })

    expect(recorded.statusCode).toBe(200)
    expect(recorded.json().data.track).toEqual(track)
    expect(recorded.json().data.playedAt).toBeGreaterThanOrEqual(before)
    expect(recorded.json().data.playedAt).toBeLessThanOrEqual(Date.now())
    expect((await app.inject({ method: 'GET', url: '/api/v1/playback/history' })).json())
      .toEqual({ data: [recorded.json().data] })
  })

  it('rejects playback history without a non-empty track id and source', async() => {
    const { app } = await createTestServer()

    for (const track of [{ id: '', source: 'kw' }, { id: 'song-1', source: '' }, { id: 'song-1' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/playback/history', payload: { track } })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('VALIDATION_ERROR')
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/playback/history' })).json()).toEqual({ data: [] })
  })

  it('moves replayed history metadata to the front and persists it across restart', async() => {
    const { app, storageRoot, webRoot } = await createTestServer()
    await app.inject({
      method: 'POST',
      url: '/api/v1/playback/history',
      payload: { track: { id: 'same', source: 'kw', name: 'Old' } },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/playback/history',
      payload: { track: { id: 'other', source: 'wy', name: 'Other' } },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/playback/history',
      payload: { track: { id: 'same', source: 'kw', name: 'New' } },
    })
    await app.close()
    apps.splice(apps.indexOf(app), 1)

    const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(restarted)
    const entries = (await restarted.inject({ method: 'GET', url: '/api/v1/playback/history' })).json().data
    expect(entries).toHaveLength(2)
    expect(entries.map((entry: { track: { id: string } }) => entry.track.id)).toEqual(['same', 'other'])
    expect(entries[0].track.name).toBe('New')
  })

  it('persists created lists and tracks across a server restart', async() => {
    const { app, storageRoot, webRoot } = await createTestServer()
    const list = await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'roadtrip', name: 'Road trip' }] } })
    expect(list.statusCode).toBe(201)
    const track = { id: 'track-1', name: 'Test song', singer: 'Test artist', source: 'kw', interval: '03:00', meta: { songId: '1', albumName: 'Test' } }
    expect((await app.inject({ method: 'POST', url: '/api/v1/playlists/roadtrip/tracks', payload: { tracks: [track] } })).statusCode).toBe(201)
    await app.close()
    apps.splice(apps.indexOf(app), 1)

    const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(restarted)
    expect((await restarted.inject({ method: 'GET', url: '/api/v1/playlists/roadtrip' })).json()).toMatchObject({
      data: { id: 'roadtrip', name: 'Road trip', locationUpdateTime: null, tracks: [track] },
    })
  })

  it('derives download group directories from server-owned list data only', async() => {
    const { app } = await createTestServer()
    expect((await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'download.isSavePathGroupByListName': true },
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/playlists',
      payload: { position: -1, playlists: [{ id: 'server-list', name: '../Server:/Road?*' }] },
    })).statusCode).toBe(201)

    const createDownload = async(trackId: string, listId: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/downloads',
        payload: {
          musicInfo: {
            id: trackId,
            name: 'Grouped song',
            singer: 'Artist',
            source: 'kw',
            interval: '00:02',
            meta: { songId: trackId, albumName: '', _qualitys: { '128k': {} } },
          },
          quality: '128k',
          listId,
        },
      })
      expect(response.statusCode).toBe(201)
      return response.json().data.id as string
    }
    const relativePath = (id: string) => {
      const row = getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(id) as { record: string }
      return (JSON.parse(row.record) as { finalRelativePath: string }).finalRelativePath
    }

    const original = await createDownload('grouped-original', 'server-list')
    expect(relativePath(original)).toMatch(/^audio\/\.\.ServerRoad\/Grouped song - Artist\.mp3$/)
    expect(relativePath(original)).not.toContain('Browser Owned Escape')

    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/downloads',
      payload: { musicInfo: { id: 'x', source: 'kw' }, quality: '128k', listName: 'Browser Owned Escape' },
    })).json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    expect((await app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/server-list',
      payload: { name: 'Renamed List' },
    })).statusCode).toBe(200)
    const renamed = await createDownload('grouped-renamed', 'server-list')
    expect(relativePath(renamed)).toMatch(/^audio\/Renamed List\/Grouped song - Artist\.mp3$/)

    const missing = await createDownload('grouped-missing', 'missing-list')
    expect(relativePath(missing)).toMatch(/^audio\/Default\/Grouped song - Artist\.mp3$/)
  })

  it('filters local path-bearing records from browser list DTOs', async() => {
    const { app, storageRoot } = await createTestServer()
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'privacy', name: 'Privacy' }] } })
    const privatePath = path.join(storageRoot, 'audio', 'private.mp3')
    const local = { id: privatePath, name: 'Private', singer: '', source: 'local', interval: '01:00', meta: { songId: privatePath, filePath: privatePath, albumName: '' } }
    const online = { id: 'online-1', name: 'Online', singer: 'Artist', source: 'kw', interval: '01:00', meta: { songId: 'online-1', albumName: '' } }
    await app.inject({ method: 'POST', url: '/api/v1/playlists/privacy/tracks', payload: { tracks: [local, online] } })

    const response = await app.inject({ method: 'GET', url: '/api/v1/playlists/privacy' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.tracks).toEqual([online])
    expect(response.body).not.toContain(privatePath)
  })

  it('preserves position and order for batched list add, update, and remove actions', async() => {
    const created = await createTestServer()
    let { app } = created
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'a', name: 'A' }] } })
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'c', name: 'C' }] } })
    const add = {
      position: 1,
      listInfos: [
        { id: 'b', name: 'B', locationUpdateTime: null },
        { id: 'd', name: 'D', locationUpdateTime: null },
      ],
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: add.position, playlists: add.listInfos } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists' })).json().data.map((list: { id: string }) => list.id)).toEqual(['a', 'b', 'd', 'c'])
    await app.close()
    apps.splice(apps.indexOf(app), 1)
    app = await createServer({ storageRoot: created.storageRoot, webRoot: created.webRoot, host: '127.0.0.1', port: 0 })
    apps.push(app)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists' })).json().data.map((list: { id: string }) => list.id)).toEqual(['a', 'b', 'd', 'c'])

    const update = [
      { id: 'b', name: 'B2', locationUpdateTime: null },
      { id: 'd', name: 'D2', locationUpdateTime: null },
    ]
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/playlists', payload: { playlists: update } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists' })).json().data.map((list: { name: string }) => list.name)).toEqual(['A', 'B2', 'D2', 'C'])

    expect((await app.inject({ method: 'DELETE', url: '/api/v1/playlists/b' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/playlists/d' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists' })).json().data.map((list: { id: string }) => list.id)).toEqual(['a', 'c'])
  })

  it('optionally includes Service built-in playlists without changing the Web default response', async() => {
    const { app } = await createTestServer()
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'custom', name: 'Custom' }] } })

    const defaultIds = (await app.inject({ method: 'GET', url: '/api/v1/playlists' })).json().data
      .map((list: { id: string }) => list.id)
    const complete = (await app.inject({ method: 'GET', url: '/api/v1/playlists?includeBuiltIn=true' })).json().data

    expect(defaultIds).toEqual(['custom'])
    expect(complete.map((list: { id: string }) => list.id)).toEqual(['default', 'love', 'custom'])
    expect(complete.slice(0, 2)).toEqual([
      { id: 'default', name: 'list__name_default' },
      { id: 'love', name: 'list__name_love' },
    ])
  })

  it('validates a whole list batch before mutating any item', async() => {
    const { app } = await createTestServer()
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'a', name: 'A' }] } })

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists',
      payload: {
        playlists: [
          { id: 'a', name: 'Changed', locationUpdateTime: null },
          { id: 'missing', name: 'Missing', locationUpdateTime: null },
        ],
      },
    })

    expect(response.statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists/a' })).json().data.name).toBe('A')
  })

  it('publishes an exact domain event envelope over SSE', async() => {
    const { app } = await createTestServer()
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const stream = await fetch(`${origin}/api/v1/events`)
    const reader = stream.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': connected\n\n')
    const action = {
      position: 0,
      listInfos: [
        { id: 'first', name: 'First', locationUpdateTime: null },
        { id: 'second', name: 'Second', locationUpdateTime: null },
      ],
    }

    const response = await fetch(`${origin}/api/v1/playlists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position: action.position, playlists: action.listInfos }),
    })
    expect(response.status).toBe(201)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(`event: playlists.created\ndata: ${JSON.stringify({ type: 'playlists.created', data: action, sequence: 2 })}\n\n`)
    await reader.cancel()
  })

  it('uses the stable error envelope for invalid settings and missing lists', async() => {
    const { app } = await createTestServer()

    expect((await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { missing: true } })).json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists/missing' })).json()).toEqual({
      error: { code: 'LIST_NOT_FOUND', message: 'List not found: missing' },
    })
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'download.savePath': '/tmp/outside' } })).json()).toEqual({
      error: { code: 'IMMUTABLE_SETTING', message: 'Download path is managed by the Service' },
    })
  })

  it('keeps API misses in the error envelope while returning the web shell for client routes', async() => {
    const { app } = await createTestServer()

    expect((await app.inject({ method: 'GET', url: '/api/v1/unknown' })).json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'API route not found' },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1' })).json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'API route not found' },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/' })).json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'API route not found' },
    })
    expect((await app.inject({ method: 'GET', url: '/library/roadtrip' })).body).toContain('<title>TuneFlow · 音流</title>')
  })

  it('does not retain tracks when a deleted list id is recreated', async() => {
    const { app } = await createTestServer()
    const track = { id: 'stale-track', name: 'Old song', singer: 'Artist', source: 'kw', interval: '03:00', meta: { songId: 'old', albumName: 'Old' } }
    await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'reused-id', name: 'Original' }] } })
    await app.inject({ method: 'POST', url: '/api/v1/playlists/reused-id/tracks', payload: { tracks: [track] } })
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/playlists/reused-id' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: '/api/v1/playlists', payload: { position: -1, playlists: [{ id: 'reused-id', name: 'Replacement' }] } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists/reused-id' })).json().data.tracks).toEqual([])
  })
})
