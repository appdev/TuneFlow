import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { registerAccountRoutes } from './routes'
import { ServiceEvents } from '../routes/events'
import { ApiError } from '../errors'
import type { ApiFastifyInstance } from '../api/types'
import { init, close } from '../db/core/db'
import { getAllUserList, getListMusics, musicsAdd } from '../db/lists'

vi.mock('../../renderer/utils/musicSdk/tx/musicInfo', () => ({
  default: async(mid: string) => {
    if (mid === 'failed-fixture') throw new Error('one track unavailable')
    if (mid === 'missing-fixture') return null
    return { source: 'tx', songmid: mid, name: 'Fixture song', singer: 'Fixture artist', interval: '03:00', songId: 1, strMediaMid: mid, albumId: 'fixtureAlbum', albumName: 'Fixture album', types: [{ type: '128k', size: null }], _types: { '128k': { size: null } } }
  },
}))
process.env.TUNEFLOW_SERVICE_NODE_MODULES = path.join(process.cwd(), 'dist/server/node_modules')
let root: string | undefined; let app: ReturnType<typeof Fastify> | undefined
afterEach(async() => { const closing = app; app = undefined; if (closing) await closing.close(); close(); vi.unstubAllGlobals(); if (root) rmSync(root, { recursive: true, force: true }); root = undefined })

it('shares QQ authorization, complete imports and tolerant recommendations without access passwords; logout preserves data', async() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'shared-account-flow-')); init(root)
  const calls: Array<{ host: string, cookie: boolean }> = []
  const rawSong = { mid: 'fixtureMid', id: 1, title: 'Fixture song', singer: [{ name: 'Fixture artist' }], album: { mid: 'fixtureAlbum', name: 'Fixture album' }, interval: 180, file: { media_mid: 'fixtureMid', size_128mp3: 1, size_320mp3: 0, size_flac: 0, size_hires: 0 } }
  vi.stubGlobal('fetch', async(input: string | URL, options: RequestInit) => {
    const url = new URL(String(input)); calls.push({ host: url.hostname, cookie: new Headers(options.headers).has('cookie') })
    if (url.hostname === 'c6.y.qq.com') return Response.json({ code: 0, data: { creator: { encrypt_uin: 'fixtureEncryptedOwner', nick: 'Fixture account' } } })
    const body = JSON.parse(String(options.body)); const result: Record<string, unknown> = { code: 0 }
    for (const [key, request] of Object.entries(body)) {
      if (key === 'comm') continue
      let data: unknown = {}
      if (key === 'created') data = { v_playlist: [{ dirid: 201, dirname: '我喜欢', songnum: 1 }] }
      else if (key === 'favorite') data = { v_list: [], hasmore: false }
      else if (key === 'liked') data = { songlist: [rawSong], total_song_num: 1 }
      else if (key === 'detail') data = { songlist: [rawSong], total_song_num: 1 }
      else if (key === 'radio') data = request.param.Page === 1 ? { VecSongs: [{ mid: 'fixtureMid' }, { mid: 'failed-fixture' }, { mid: 'missing-fixture' }] } : { VecSongs: [] }
      result[key] = { code: 0, data }
    }
    return Response.json(result)
  })
  app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
  app.setErrorHandler((error, _request, reply) => { if (error instanceof ApiError) void reply.code(error.statusCode).send(error.toBody()); else void reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } }) })
  const events = new ServiceEvents(); registerAccountRoutes(app as ApiFastifyInstance, root, events); await app.ready()
  const request = async(url: string, token?: string, payload?: unknown, method = payload == null ? 'GET' : 'POST') => app!.inject({ url, method: method as any, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload == null ? {} : { payload }) })
  const owner = { token: undefined }; const second = { token: undefined }
  const uploaded = await request('/api/v1/accounts/tx/session', owner.token, { revision: 0, credential: { cookies: { qqmusic_key: 'synthetic-music-session', qqmusic_uin: '123456', login_type: '1', p_skey: 'must-not-persist' } } })
  expect(uploaded.statusCode).toBe(200)
  const status = (await request('/api/v1/accounts/status', second.token)).json().data
  expect(status.tx).toBe(true); expect(status.revisions.tx).toBe(1)
  expect(JSON.stringify(status)).not.toMatch(/synthetic-music-session|must-not-persist|cookies/)
  const playlists = (await request('/api/v1/accounts/tx/playlists', second.token)).json().data
  expect(playlists.playlists.map((item: { id: string }) => item.id)).toEqual(['dir:201'])
  const imported = await request('/api/v1/accounts/tx/import', second.token, { id: 'dir:201', revision: 1 })
  expect(imported.statusCode).toBe(200)
  const id = imported.json().data.id
  const original = getListMusics(id)[0]
  musicsAdd(id, [{ ...original, id: 'user-edited-fixture', name: 'User preserved song' }], 'bottom')
  await request('/api/v1/accounts/tx/import', owner.token, { id: 'dir:201', revision: 1 })
  expect(getAllUserList().filter(item => item.id === id)).toHaveLength(1)
  expect(getListMusics(id).map(item => item.id)).toContain('user-edited-fixture')
  const daily = (await request('/api/v1/accounts/tx/daily', second.token)).json().data
  expect(daily.status).toBe('personalized'); expect(daily.kind).toBe('radar'); expect(daily.list).toHaveLength(1)
  expect(calls.every(item => item.cookie)).toBe(true)
  await request('/api/v1/accounts/tx/logout', owner.token, { revision: 1 })
  expect((await request('/api/v1/accounts/status', second.token)).json().data.tx).toBe(false)
  expect((await request('/api/v1/accounts/tx/daily', second.token)).json().data.list).toEqual([])
  expect((await request('/api/v1/accounts/tx/import', second.token, { id: 'dir:201', revision: 1 })).statusCode).toBe(409)
  expect(getListMusics(id)).toHaveLength(2)
  expect(JSON.stringify(events.snapshot())).not.toMatch(/Fixture account|synthetic|cookies/)
})
