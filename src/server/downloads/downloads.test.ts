/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { createServer as createHttpServer } from 'node:http'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getExt, getMusicTypes, makeFileName, reserveFileName } from './filenames'
import { DownloadManager } from './manager'
import { LibraryScanner } from '../library/scanner'
import { LibraryResourceStore } from '../library/resources'
import { registerLibraryRoutes } from '../routes/library'
import { close as closeDatabase, getDB, init as initDatabase } from '../db/core/db'
import { applyDownloadMetadata } from './metadata'
import { parseFile } from 'music-metadata'
import { apeFixture } from './apeFixture.testData'

process.env.TUNEFLOW_SERVICE_NODE_MODULES = path.join(process.cwd(), 'dist/server/node_modules')

const bytes = Buffer.from(Array.from({ length: 64 * 1024 }, (_, index) => index % 251))
const validMp3 = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
const roots: string[] = []
const servers: Array<ReturnType<typeof createHttpServer>> = []
const apps: Array<ReturnType<typeof Fastify>> = []

const fixtureTrack = {
  id: 'fixture-track',
  name: 'A/B:Song?*#"<>|',
  singer: 'One、Two',
  source: 'kw',
  interval: '00:02',
  meta: { songId: 'fixture-track', albumName: 'Fixture', _qualitys: { '128k': {}, flac: {} } },
} as unknown as TuneFlow.Music.MusicInfoOnline

const minimalFlac = (): Buffer => Buffer.from('ZkxhQwAAACISABIAAAAOAAAQCsRC8AAArETSsSAZkBm2OdWn4rNGPpyXhAAALg0AAABMYXZmNjIuMTIuMTAyAQAAABUAAABlbmNvZGVyPUxhdmY2Mi4xMi4xMDL/+FkYAGsAAAAAAAAQiv/4WRgBbAAAAAAAAIf///hZGAJlAAAAAAAAvmX/+FkYA2IAAAAAAAApEP/4WRgEdwAAAAAAAM1R//hZGAVwAAAAAAAAWiT/+FkYBnkAAAAAAABjvv/4WRgHfgAAAAAAAPTL//hZGAhTAAAAAAAAKzn/+HkYCQpDcAAAAAAAAJiF', 'base64')

const metadataSettings = (patch: Partial<TuneFlow.AppSetting> = {}): TuneFlow.AppSetting => ({
  'download.isEmbedPic': false,
  'download.isEmbedLyric': false,
  'download.isDownloadLrc': false,
  'download.isEmbedVerbatimLyric': false,
  'download.isEmbedLyricT': false,
  'download.isEmbedLyricR': false,
  'download.isDownloadVerbatimLyric': false,
  'download.isDownloadTLrc': false,
  'download.isDownloadRLrc': false,
  'download.lrcFormat': 'utf8',
  ...patch,
} as TuneFlow.AppSetting)

const startUpstream = async(options: { range?: boolean, disconnectOnce?: boolean, payload?: Buffer, status?: number } = {}) => {
  const requests: Array<{ range?: string }> = []
  let disconnect = options.disconnectOnce === true
  const payload = options.payload ?? bytes
  const server = createHttpServer((request, response) => {
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined
    requests.push({ range })
    if (options.status != null && options.status >= 400) {
      response.writeHead(options.status)
      response.end()
      return
    }
    const start = range == null ? 0 : Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0)
    const canRange = options.range !== false && range != null
    response.writeHead(canRange ? 206 : 200, {
      'content-type': 'audio/mpeg',
      'content-length': payload.length - (canRange ? start : 0),
      ...(options.range === false ? {} : { 'accept-ranges': 'bytes' }),
      etag: '"fixture-v1"',
      ...(canRange ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {}),
    })
    if (disconnect) {
      disconnect = false
      response.write(payload.subarray(0, 8192))
      response.destroy()
      return
    }
    response.end(payload.subarray(canRange ? start : 0))
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`, requests }
}

const createRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-downloads-'))
  roots.push(root)
  mkdirSync(path.join(root, 'audio'))
  mkdirSync(path.join(root, 'tmp'))
  if (initDatabase(root) == null) throw new Error('Unable to initialize fixture database')
  return root
}

afterEach(async() => {
  await Promise.all(apps.splice(0).map(app => app.close()))
  await Promise.all(servers.splice(0).map(async server => new Promise<void>(resolve => server.close(() => { resolve() }))))
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('TuneFlow download policy', () => {
  it('matches every upstream quality extension and the three filename patterns', () => {
    expect(['ape', 'flac', 'flac24bit', 'wav', '128k', '192k', '320k', 'unknown'].map(getExt))
      .toEqual(['ape', 'flac', 'flac', 'wav', 'mp3', 'mp3', 'mp3', 'mp3'])
    expect(makeFileName('歌名 - 歌手', fixtureTrack.name, fixtureTrack.singer, 'mp3')).toBe('ABSong - One、Two.mp3')
    expect(makeFileName('歌手 - 歌名', fixtureTrack.name, fixtureTrack.singer, 'flac')).toBe('One、Two - ABSong.flac')
    expect(makeFileName('歌名', fixtureTrack.name, fixtureTrack.singer, 'wav')).toBe('ABSong.wav')
  })

  it('orders available download qualities from the requested ceiling downwards', () => {
    const track = {
      ...fixtureTrack,
      meta: { ...fixtureTrack.meta, _qualitys: { flac24bit: {}, flac: {}, '320k': {}, '128k': {} } },
    } as TuneFlow.Music.MusicInfoOnline
    expect(getMusicTypes(track, 'flac24bit', { kw: ['flac24bit', 'flac', '320k', '128k'] })).toEqual(['flac24bit', 'flac', '320k', '128k'])
    expect(getMusicTypes(track, '320k', { kw: ['flac24bit', 'flac', '320k', '128k'] })).toEqual(['320k', '128k'])
  })

  it('clips TuneFlow names and atomically reserves collision suffixes without overwrite', () => {
    const root = createRoot()
    const longSinger = new Array(60).fill('歌手').join('、')
    expect(makeFileName('歌名 - 歌手', '歌'.repeat(140), longSinger, 'mp3').replace('.mp3', '').length).toBe(150)
    writeFileSync(path.join(root, 'audio', 'Song.mp3'), 'original')
    writeFileSync(path.join(root, 'audio', 'Song (1).mp3'), 'collision')
    expect(reserveFileName(path.join(root, 'audio'), 'Song.mp3')).toBe('Song (2).mp3')
    expect(readFileSync(path.join(root, 'audio', 'Song.mp3'), 'utf8')).toBe('original')
  })

  it('preserves raw bytes when embedding is disabled and writes MP3 and APE metadata when enabled', async() => {
    const root = createRoot()
    const mp3 = path.join(root, 'audio', 'metadata.mp3')
    const ape = path.join(root, 'audio', 'metadata.ape')
    const original = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
    writeFileSync(mp3, original)
    writeFileSync(ape, apeFixture)
    const baseSettings = metadataSettings()
    const record = {
      musicInfo: fixtureTrack,
      extension: 'mp3',
    } as unknown as Parameters<typeof applyDownloadMetadata>[1]
    await applyDownloadMetadata(mp3, record, baseSettings)
    expect(readFileSync(mp3)).toEqual(original)
    await applyDownloadMetadata(mp3, record, { ...baseSettings, 'download.isEmbedLyric': true }, {
      getLyrics: async() => ({ lyric: '[00:00.00]Fixture lyric' }),
    })
    expect((await parseFile(mp3)).common.title).toBe(fixtureTrack.name)
    await applyDownloadMetadata(ape, { ...record, extension: 'ape' }, { ...baseSettings, 'download.isEmbedLyric': true }, {
      getLyrics: async() => ({ lyric: '[00:00.00]Fixture lyric' }),
    })
    expect((await parseFile(ape)).common).toMatchObject({
      title: fixtureTrack.name,
      lyrics: expect.anything(),
    })
  })

  it('embeds validated bundle metadata without refetching artwork or lyrics', async() => {
    const root = createRoot()
    const file = path.join(root, 'audio', 'bundle.mp3')
    writeFileSync(file, validMp3)
    const getPicture = vi.fn(async() => { throw new Error('must not fetch picture') })
    const getLyrics = vi.fn(async() => { throw new Error('must not fetch lyrics') })
    const pictureBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

    await applyDownloadMetadata(file, { musicInfo: fixtureTrack, extension: 'mp3' } as never, metadataSettings({
      'download.isEmbedPic': true,
      'download.isEmbedLyric': true,
    }), {
      getPicture,
      getLyrics,
      pictureBytes,
      pictureMimeType: 'image/png',
      lyrics: { lyric: '[00:00.00]bundle lyric' },
    })

    expect(getPicture).not.toHaveBeenCalled()
    expect(getLyrics).not.toHaveBeenCalled()
    expect((await parseFile(file)).common).toMatchObject({ lyrics: expect.anything(), picture: expect.anything() })
  })

  it('awaits valid FLAC embedding without polling and propagates asynchronous writer errors', async() => {
    const root = createRoot()
    const flac = path.join(root, 'audio', 'metadata.flac')
    const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const artwork = await startUpstream({ payload: cover })
    writeFileSync(flac, minimalFlac())
    const record = { musicInfo: fixtureTrack, extension: 'flac' } as unknown as Parameters<typeof applyDownloadMetadata>[1]
    const started = Date.now()
    await expect(Promise.race([
      applyDownloadMetadata(flac, record, metadataSettings({ 'download.isEmbedPic': true, 'download.isEmbedLyric': true }), {
        getPicture: async() => artwork.url,
        getLyrics: async() => ({ lyric: '[00:00.00]Fixture FLAC lyric' }),
      }).then(() => 'completed'),
      new Promise<string>(resolve => setTimeout(() => { resolve('timed-out') }, 1_000)),
    ])).resolves.toBe('completed')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect((await parseFile(flac)).common).toMatchObject({ title: fixtureTrack.name, lyrics: expect.anything(), picture: expect.anything() })
    expect(() => readFileSync(`${flac}.tuneflowtmp`)).toThrow()

    writeFileSync(flac, minimalFlac())
    await expect(applyDownloadMetadata(flac, record, metadataSettings({ 'download.isEmbedLyric': true }), {
      getLyrics: async() => ({ lyric: '[00:00.00]Fixture FLAC lyric' }),
      writeAudioMetadata: async() => {
        await Promise.resolve()
        throw new Error('async FLAC writer failed')
      },
    })).rejects.toThrow('async FLAC writer failed')
  })
})

describe('durable download manager', () => {
  it('uses default download policy for playback saves when normal downloads are disabled', async() => {
    const root = createRoot()
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({
        'download.enable': false,
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
        'download.isSavePathGroupByListName': true,
        'download.skipExistFile': false,
      } as TuneFlow.AppSetting),
      resolve: async() => { throw new Error('not started') },
    })

    const job = await manager.createForPlayback(fixtureTrack)

    expect(job).toMatchObject({ fileName: 'ABSong - One、Two.flac', quality: 'flac', extension: 'flac' })
    expect(existsSync(path.join(root, 'audio', 'Default'))).toBe(false)
    manager.close()
  })

  it('coalesces concurrent playback-save creation before the filesystem check completes', async() => {
    const root = createRoot()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let checks = 0
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({
        'download.enable': true,
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
      } as TuneFlow.AppSetting),
      findExistingFile: async() => { checks++; await gate; return undefined },
      resolve: async() => { throw new Error('not started') },
    })

    const first = manager.createForPlayback(fixtureTrack)
    const second = manager.createForPlayback(fixtureTrack)
    await Promise.resolve()
    release()

    const [firstJob, secondJob] = await Promise.all([first, second])
    expect(checks).toBe(1)
    expect(secondJob.id).toBe(firstJob.id)
    expect(manager.list()).toHaveLength(1)
    manager.close()
  })

  it('persists final post-metadata integrity for completed downloads', async() => {
    const root = createRoot()
    const audio = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
    const upstream = await startUpstream({ payload: audio })
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({
        'download.enable': true,
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
      } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })

    const job = await manager.createForPlayback(fixtureTrack)
    await manager.waitForIdle()
    const finalPath = path.join(root, 'audio', manager.get(job.id)!.fileName)
    const expected = { size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }
    const persisted = JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record)

    expect(persisted.finalIntegrity).toEqual(expected)
    expect(manager.expectedIntegrity(finalPath)).toEqual(expected)
    manager.close()
  })

  it('downgrades to the next available quality when a higher quality cannot be resolved', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const attempted: TuneFlow.Quality[] = []
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async(job) => {
        attempted.push(job.quality)
        if (job.quality === 'flac') throw new Error('lossless unavailable')
        return { url: upstream.url, headers: {} }
      },
      metadata: async() => {},
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: 'flac24bit', qualityPolicy: 'highest' })
    await manager.waitForIdle()

    expect(attempted).toEqual(['flac', '128k'])
    expect(manager.get(job.id)).toMatchObject({ status: 'completed', quality: '128k', extension: 'mp3', fileName: 'ABSong.mp3' })
    manager.close()
  })

  it('downgrades after a higher-quality URL fails during transfer', async() => {
    const root = createRoot()
    const unavailable = await startUpstream({ status: 502 })
    const fallback = await startUpstream()
    const attempted: TuneFlow.Quality[] = []
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async(job) => {
        attempted.push(job.quality)
        return { url: job.quality === 'flac' ? unavailable.url : fallback.url, headers: {} }
      },
      metadata: async() => {},
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: 'flac24bit', qualityPolicy: 'highest' })
    await manager.waitForIdle()

    expect(attempted).toEqual(['flac', '128k'])
    expect(manager.get(job.id)).toMatchObject({ status: 'completed', quality: '128k', extension: 'mp3' })
    expect(readFileSync(path.join(root, 'audio', 'ABSong.mp3'))).toEqual(bytes)
    manager.close()
  })

  it('uses an actual audio file without a database record instead of creating a duplicate', async() => {
    const root = createRoot()
    const existing = path.join(root, 'audio', 'ABSong.mp3')
    writeFileSync(existing, validMp3)
    const scanner = new LibraryScanner(root, () => [path.join(root, 'audio')])
    let resolved = false
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名', 'download.skipExistFile': true } as TuneFlow.AppSetting),
      findExistingFile: async musicInfo => (await scanner.findMatchingFile(musicInfo))?.filePath,
      resolve: async() => { resolved = true; throw new Error('must not resolve') },
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: 'flac24bit', skipExisting: true, qualityPolicy: 'highest' })

    expect(job).toMatchObject({ status: 'completed', quality: '128k', fileName: 'ABSong.mp3', downloaded: validMp3.length, total: validMp3.length })
    expect(resolved).toBe(false)
    expect(readFileSync(existing)).toEqual(validMp3)
    manager.close()
  })

  it('relocates a stale completed record by scanning the actual audio directory', async() => {
    const root = createRoot()
    const upstream = await startUpstream({ payload: validMp3 })
    const scanner = new LibraryScanner(root, () => [path.join(root, 'audio')])
    const options = {
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名', 'download.skipExistFile': true } as TuneFlow.AppSetting),
      findExistingFile: async(musicInfo: TuneFlow.Music.MusicInfoOnline) => (await scanner.findMatchingFile(musicInfo))?.filePath,
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    }
    const manager = new DownloadManager(options)
    const first = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.start(first.id)
    await manager.waitForIdle()
    const movedDirectory = path.join(root, 'audio', 'Moved by user')
    mkdirSync(movedDirectory)
    const moved = path.join(movedDirectory, first.fileName)
    renameSync(path.join(root, 'audio', first.fileName), moved)

    const found = await manager.create({ musicInfo: fixtureTrack, quality: '128k', skipExisting: true })

    expect(found).toMatchObject({ id: first.id, status: 'completed', fileName: first.fileName })
    expect((await scanner.findMatchingFile(fixtureTrack))?.filePath).toBe(realpathSync(moved))
    expect(readFileSync(moved)).toEqual(validMp3)
    manager.close()
  })

  it('preserves a damaged completed file and downloads a collision-safe replacement', async() => {
    const root = createRoot()
    const upstream = await startUpstream({ payload: validMp3 })
    let manager!: DownloadManager
    const scanner = new LibraryScanner(
      root,
      () => [path.join(root, 'audio')],
      filePath => manager.expectedIntegrity(filePath),
    )
    const track = {
      ...fixtureTrack,
      meta: { ...fixtureTrack.meta, _qualitys: { '128k': {} } },
    } as TuneFlow.Music.MusicInfoOnline
    manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({
        'download.enable': true,
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
      } as TuneFlow.AppSetting),
      findExistingFile: async musicInfo => (await scanner.findMatchingFile(musicInfo))?.filePath,
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const first = await manager.createForPlayback(track)
    await manager.waitForIdle()
    const originalPath = path.join(root, 'audio', manager.get(first.id)!.fileName)
    const damaged = Buffer.concat([validMp3, Buffer.from('damaged')])
    writeFileSync(originalPath, damaged)

    const replacement = await manager.createForPlayback(track)
    await manager.waitForIdle()

    expect(replacement.id).not.toBe(first.id)
    expect(replacement.fileName).toBe('ABSong (1).mp3')
    expect(readFileSync(originalPath)).toEqual(damaged)
    expect(readFileSync(path.join(root, 'audio', replacement.fileName))).toEqual(validMp3)
    manager.close()
  })

  it('ignores a settings-provided in-storage path and publishes only below the Service audio root', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const nonAudioRoot = path.join(root, 'sources', 'legacy-downloads')
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': nonAudioRoot, 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.waitForIdle()

    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(bytes)
    expect(existsSync(path.join(nonAudioRoot, job.fileName))).toBe(false)
    manager.close()
  })

  it('normalizes persisted source tracks that predate the required API id', () => {
    const root = createRoot()
    const options = {
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { throw new Error('not used') },
    }
    new DownloadManager(options).close()
    const now = Date.now()
    const legacy = {
      id: 'undefined_320k_mp3',
      status: 'error',
      musicInfo: { ...fixtureTrack, id: undefined, songmid: 'legacy-songmid' },
      quality: '320k',
      extension: 'mp3',
      fileName: 'Legacy.mp3',
      finalRelativePath: 'audio/Legacy.mp3',
      partRelativePath: 'tmp/undefined_320k_mp3.part',
      downloaded: 0,
      total: 0,
      error: 'Legacy fixture',
      createdAt: now,
      updatedAt: now,
    }
    getDB().prepare('INSERT INTO web_downloads (id, status, record, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(legacy.id, legacy.status, JSON.stringify(legacy), now, now)

    const manager = new DownloadManager(options)

    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: legacy.id,
        musicInfo: expect.objectContaining({ id: 'legacy-songmid', songmid: 'legacy-songmid' }),
      }),
    ])
    expect(JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(legacy.id) as { record: string }).record))
      .toMatchObject({ musicInfo: { id: 'legacy-songmid', songmid: 'legacy-songmid' } })
    manager.close()
  })

  it('publishes completed only after raw bytes are atomically renamed and removes the part', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const states: string[] = []
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
      publish: jobs => states.push(jobs[0]?.status ?? 'empty'),
    })
    const job = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.waitForIdle()

    const completed = manager.get(job.id)!
    expect(completed.status).toBe('completed')
    expect(readFileSync(path.join(root, 'audio', completed.fileName))).toEqual(bytes)
    expect(() => readFileSync(path.join(root, 'tmp', `${job.id}.part`))).toThrow()
    expect(states.at(-1)).toBe('completed')
    expect(manager.list().some(item => JSON.stringify(item).includes(root))).toBe(false)
    manager.close()
  })

  it('materializes resources after metadata and before library refresh', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const order: string[] = []
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => { order.push('metadata') },
      materializeResources: async filePath => {
        order.push('resources')
        expect(existsSync(filePath)).toBe(true)
      },
      onCompleted: async() => { order.push('refresh') },
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.waitForIdle()

    expect(order).toEqual(['metadata', 'resources', 'refresh'])
    expect(manager.get(job.id)?.status).toBe('completed')
    manager.close()
  })

  it('keeps the completed audio and records a warning when resource materialization fails', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
      materializeResources: async() => { throw new Error('fixture resource failure') },
    })

    const job = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.waitForIdle()

    const completed = manager.get(job.id)!
    expect(completed).toMatchObject({ status: 'completed', warning: 'Resources: fixture resource failure' })
    expect(readFileSync(path.join(root, 'audio', completed.fileName))).toEqual(bytes)
    manager.close()
  })

  it('recovers running as paused on restart and resumes with a validated byte Range', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const first = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    writeFileSync(path.join(root, 'tmp', `${job.id}.part`), bytes.subarray(0, 4096))
    first.__setStateForTest(job.id, 'running', { downloaded: 4096, etag: '"fixture-v1"' })
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    expect(restarted.get(job.id)?.status).toBe('paused')
    await restarted.resume(job.id)
    await restarted.waitForIdle()
    expect(readFileSync(path.join(root, 'audio', restarted.get(job.id)!.fileName))).toEqual(bytes)
    expect(upstream.requests.some(request => request.range === 'bytes=4096-')).toBe(true)
    restarted.close()
  })

  it('restarts at byte zero when Range is unsupported and cleans orphan parts', async() => {
    const root = createRoot()
    const upstream = await startUpstream({ range: false })
    writeFileSync(path.join(root, 'tmp', 'orphan.part'), 'orphan')
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    expect(() => readFileSync(path.join(root, 'tmp', 'orphan.part'))).toThrow()
    const job = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    writeFileSync(path.join(root, 'tmp', `${job.id}.part`), bytes.subarray(0, 2048))
    manager.__setStateForTest(job.id, 'paused', { downloaded: 2048, etag: '"fixture-v1"' })
    await manager.resume(job.id)
    await manager.waitForIdle()
    expect(upstream.requests.map(request => request.range)).toEqual(['bytes=2048-', undefined])
    expect(readFileSync(path.join(root, 'audio', manager.get(job.id)!.fileName))).toEqual(bytes)
    manager.close()
  })

  it('keeps a completed file when metadata fails and reserves duplicate jobs with suffixes', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => { throw new Error('fixture metadata failure') },
    })
    const first = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    const second = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    expect([first.fileName, second.fileName]).toEqual(['ABSong.mp3', 'ABSong (1).mp3'])
    await manager.start(first.id)
    await manager.waitForIdle()
    expect(manager.get(first.id)).toMatchObject({ status: 'completed', warning: 'Metadata: fixture metadata failure' })
    expect(readFileSync(path.join(root, 'audio', first.fileName))).toEqual(bytes)
    manager.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
    })
    expect(restarted.get(first.id)).toMatchObject({ status: 'completed', downloaded: bytes.length, total: bytes.length, progress: 100 })
    restarted.close()
  })

  it('reuses the original filename after a completed download is deleted outside the app', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const first = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    await manager.start(first.id)
    await manager.waitForIdle()
    expect(manager.get(first.id)).toMatchObject({ status: 'completed', fileName: 'ABSong.mp3' })

    rmSync(path.join(root, 'audio', first.fileName))
    const replacement = await manager.create({ musicInfo: fixtureTrack, quality: '128k' })
    expect(replacement.fileName).toBe('ABSong.mp3')
    await manager.remove(replacement.id)
    manager.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const afterRestart = await restarted.create({ musicInfo: fixtureTrack, quality: '128k' })
    expect(afterRestart.fileName).toBe('ABSong.mp3')
    await restarted.start(first.id)
    await restarted.waitForIdle()
    expect(restarted.get(first.id)?.fileName).toBe('ABSong (1).mp3')
    expect((await restarted.create({ musicInfo: fixtureTrack, quality: '128k' })).fileName).toBe('ABSong (2).mp3')
    restarted.close()
  })

  it('keeps a raw FLAC completed with a warning when its awaited metadata writer rejects asynchronously', async() => {
    const root = createRoot()
    const original = minimalFlac()
    const upstream = await startUpstream({ payload: original })
    const manager = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({
        ...metadataSettings({ 'download.isEmbedLyric': true }),
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
      } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async(filePath, job, settings) => applyDownloadMetadata(filePath, job, settings, {
        getLyrics: async() => ({ lyric: '[00:00.00]Fixture FLAC lyric' }),
        writeAudioMetadata: async() => {
          await Promise.resolve()
          throw new Error('async FLAC writer failed')
        },
      }),
    })
    const job = await manager.create({ musicInfo: fixtureTrack, quality: 'flac' })
    await manager.waitForIdle()

    expect(manager.get(job.id)).toMatchObject({ status: 'completed', warning: 'Metadata: async FLAC writer failed' })
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(original)
    expect(() => readFileSync(path.join(root, 'audio', `${job.fileName}.tuneflowtmp`))).toThrow()
    manager.close()
  })

  it('recovers a final published in the post-rename crash window without resolving or downloading again', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const embeddedSuffix = Buffer.from('metadata changed the published file size')
    let resolveCount = 0
    const first = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      finalizationCheckpoint: async(point, record) => {
        if (point !== 'after-publication') return
        const final = path.join(root, 'audio', record.fileName)
        writeFileSync(final, Buffer.concat([readFileSync(final), embeddedSuffix]))
        return 'simulate-crash'
      },
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    await first.waitForIdle()
    expect(first.get(job.id)?.status).toBe('running')
    expect(JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record))
      .toMatchObject({ publication: { phase: 'published' } })
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(Buffer.concat([bytes, embeddedSuffix]))
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
    })
    expect(restarted.get(job.id)).toMatchObject({
      status: 'completed',
      downloaded: bytes.length + embeddedSuffix.length,
      total: bytes.length + embeddedSuffix.length,
      progress: 100,
    })
    await restarted.resume(job.id)
    await restarted.waitForIdle()
    expect(resolveCount).toBe(1)
    expect(upstream.requests).toHaveLength(1)
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(Buffer.concat([bytes, embeddedSuffix]))
    restarted.close()
  })

  it.each(['before-marker', 'after-marker', 'after-rename'] as const)(
    'recovers the %s finalization crash point without a second resolve or download',
    async checkpoint => {
      const root = createRoot()
      const upstream = await startUpstream()
      let resolveCount = 0
      const first = new DownloadManager({
        storageRoot: root,
        getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
        resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
        metadata: async() => {},
        finalizationCheckpoint: point => point === checkpoint ? 'simulate-crash' : undefined,
      })
      const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
      await first.waitForIdle()
      expect(first.get(job.id)?.status).toBe('running')
      const persisted = JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record) as { publication?: { phase: string } }
      expect(persisted.publication?.phase).toBe(checkpoint === 'before-marker' ? undefined : 'prepared')
      first.close()

      const restarted = new DownloadManager({
        storageRoot: root,
        autoStart: false,
        getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
        resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
        metadata: async() => {},
      })
      if (restarted.get(job.id)?.status !== 'completed') await restarted.resume(job.id)
      await restarted.waitForIdle()
      expect(restarted.get(job.id)).toMatchObject({ status: 'completed', progress: 100 })
      expect(resolveCount).toBe(1)
      expect(upstream.requests).toHaveLength(1)
      expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(bytes)
      restarted.close()
    },
  )

  it('publishes a prepared part to a suffix instead of adopting or overwriting a conflicting final', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const arbitrary = Buffer.from('unrelated final created after marker preparation')
    let resolveCount = 0
    const first = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      finalizationCheckpoint: point => point === 'after-marker' ? 'simulate-crash' : undefined,
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    await first.waitForIdle()
    writeFileSync(path.join(root, 'audio', job.fileName), arbitrary)
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
    })
    expect(restarted.get(job.id)).toMatchObject({ status: 'completed', fileName: 'ABSong (1).mp3' })
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(arbitrary)
    expect(readFileSync(path.join(root, 'audio', 'ABSong (1).mp3'))).toEqual(bytes)
    expect(resolveCount).toBe(1)
    expect(upstream.requests).toHaveLength(1)
    restarted.close()
  })

  it('redownloads after rejecting a same-size prepared part hash mismatch', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const corrupt = Buffer.alloc(bytes.length, 0xa5)
    let resolveCount = 0
    const first = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      finalizationCheckpoint: point => point === 'after-marker' ? 'simulate-crash' : undefined,
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    await first.waitForIdle()
    writeFileSync(path.join(root, 'tmp', `${job.id}.part`), corrupt)
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
    })
    expect(restarted.get(job.id)).toMatchObject({
      status: 'error',
      downloaded: 0,
      total: 0,
      progress: 0,
      error: 'Prepared download publication could not be recovered',
    })
    expect(() => readFileSync(path.join(root, 'tmp', `${job.id}.part`))).toThrow()
    const rejected = JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record) as {
      publication?: unknown
      etag?: string
      lastModified?: string
    }
    expect(rejected).not.toHaveProperty('publication')
    expect(rejected).not.toHaveProperty('etag')
    expect(rejected).not.toHaveProperty('lastModified')
    await restarted.resume(job.id)
    await restarted.waitForIdle()

    expect(restarted.get(job.id)).toMatchObject({ status: 'completed', progress: 100, error: undefined })
    expect(resolveCount).toBe(2)
    expect(upstream.requests).toHaveLength(2)
    expect(upstream.requests[1]?.range).toBeUndefined()
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(bytes)
    expect(readFileSync(path.join(root, 'audio', job.fileName))).not.toEqual(corrupt)
    restarted.close()
  })

  it('starts safely when a rejected prepared part is a directory containing an outside symlink', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const outside = path.join(root, 'outside-sentinel')
    writeFileSync(outside, 'keep outside bytes')
    let resolveCount = 0
    const first = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      finalizationCheckpoint: point => point === 'after-marker' ? 'simulate-crash' : undefined,
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    await first.waitForIdle()
    const part = path.join(root, 'tmp', `${job.id}.part`)
    rmSync(part)
    mkdirSync(part)
    writeFileSync(path.join(part, 'nested-corrupt'), 'bad')
    symlinkSync(outside, path.join(part, 'outside-link'))
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
    })
    expect(restarted.get(job.id)).toMatchObject({ status: 'error', downloaded: 0, total: 0, progress: 0 })
    expect(existsSync(part)).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('keep outside bytes')
    await restarted.resume(job.id)
    await restarted.waitForIdle()
    expect(restarted.get(job.id)).toMatchObject({ status: 'completed', error: undefined })
    expect(resolveCount).toBe(2)
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(bytes)
    expect(readFileSync(outside, 'utf8')).toBe('keep outside bytes')
    restarted.close()
  })

  it('persists reset state when rejected-part cleanup throws and retries cleanup on resume', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    let resolveCount = 0
    const first = new DownloadManager({
      storageRoot: root,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      finalizationCheckpoint: point => point === 'after-marker' ? 'simulate-crash' : undefined,
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    await first.waitForIdle()
    const part = path.join(root, 'tmp', `${job.id}.part`)
    writeFileSync(part, Buffer.alloc(bytes.length, 0xa5))
    first.close()

    let cleanupAttempts = 0
    let duringCleanup: {
      status: string
      downloaded: number
      total: number
      partCleanupPending?: boolean
      publication?: unknown
      etag?: string
      lastModified?: string
    } | undefined
    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { resolveCount++; return { url: upstream.url, headers: {} } },
      metadata: async() => {},
      removePart: target => {
        cleanupAttempts++
        if (cleanupAttempts === 1) {
          duringCleanup = JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record)
          throw new Error('injected cleanup failure')
        }
        rmSync(target, { recursive: true, force: true })
      },
    })
    expect(cleanupAttempts).toBe(1)
    expect(duringCleanup).toMatchObject({ status: 'error', downloaded: 0, total: 0, partCleanupPending: true })
    expect(duringCleanup).not.toHaveProperty('publication')
    expect(duringCleanup).not.toHaveProperty('etag')
    expect(duringCleanup).not.toHaveProperty('lastModified')
    expect(restarted.get(job.id)).toMatchObject({ status: 'error', downloaded: 0, total: 0, progress: 0 })
    expect(readFileSync(part)).toEqual(Buffer.alloc(bytes.length, 0xa5))
    const rejected = JSON.parse((getDB().prepare('SELECT record FROM web_downloads WHERE id = ?').get(job.id) as { record: string }).record) as { partCleanupPending?: boolean, publication?: unknown }
    expect(rejected).toMatchObject({ partCleanupPending: true })
    expect(rejected).not.toHaveProperty('publication')

    await restarted.resume(job.id)
    await restarted.waitForIdle()
    expect(cleanupAttempts).toBe(2)
    expect(restarted.get(job.id)).toMatchObject({ status: 'completed', error: undefined })
    expect(resolveCount).toBe(2)
    expect(upstream.requests[1]?.range).toBeUndefined()
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(bytes)
    restarted.close()
  })

  it('recursively removes an orphan part directory without following an outside symlink', () => {
    const root = createRoot()
    const outside = path.join(root, 'orphan-outside-sentinel')
    const orphan = path.join(root, 'tmp', 'orphan-directory.part')
    writeFileSync(outside, 'keep orphan outside bytes')
    mkdirSync(orphan)
    writeFileSync(path.join(orphan, 'nested-corrupt'), 'bad')
    symlinkSync(outside, path.join(orphan, 'outside-link'))

    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { throw new Error('not used') },
      metadata: async() => {},
    })

    expect(existsSync(orphan)).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('keep orphan outside bytes')
    manager.close()
  })

  it('continues startup when orphan part cleanup throws', () => {
    const root = createRoot()
    const orphan = path.join(root, 'tmp', 'orphan-failure.part')
    writeFileSync(orphan, 'orphan')
    let cleanupAttempts = 0

    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => { throw new Error('not used') },
      metadata: async() => {},
      removePart: () => {
        cleanupAttempts++
        throw new Error('injected orphan cleanup failure')
      },
    })

    expect(cleanupAttempts).toBe(1)
    expect(existsSync(orphan)).toBe(true)
    manager.close()
  })

  it('never adopts or overwrites an arbitrary final for a legacy row without a publication marker', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    const arbitrary = Buffer.from('unrelated restored final bytes')
    const first = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const job = await first.create({ musicInfo: fixtureTrack, quality: '128k' })
    first.__setStateForTest(job.id, 'running', { downloaded: 17, total: 17 })
    writeFileSync(path.join(root, 'audio', job.fileName), arbitrary)
    first.close()

    const restarted = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({ 'download.savePath': path.join(root, 'audio'), 'download.maxDownloadNum': 1, 'download.fileName': '歌名' } as TuneFlow.AppSetting),
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    expect(restarted.get(job.id)?.status).not.toBe('completed')
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(arbitrary)
    await restarted.resume(job.id)
    await restarted.waitForIdle()
    expect(restarted.get(job.id)).toMatchObject({ status: 'completed', fileName: 'ABSong (1).mp3' })
    expect(readFileSync(path.join(root, 'audio', job.fileName))).toEqual(arbitrary)
    expect(readFileSync(path.join(root, 'audio', 'ABSong (1).mp3'))).toEqual(bytes)
    restarted.close()
  })

  it('resolves grouping from server-owned listId names and freezes the reserved directory at creation', async() => {
    const root = createRoot()
    const upstream = await startUpstream()
    let serverName: string | undefined = '../Road:/Trip?*'
    const manager = new DownloadManager({
      storageRoot: root,
      autoStart: false,
      getSettings: () => ({
        'download.savePath': path.join(root, 'audio'),
        'download.maxDownloadNum': 1,
        'download.fileName': '歌名',
        'download.isSavePathGroupByListName': true,
      } as TuneFlow.AppSetting),
      resolveListName: listId => listId === 'server-list' ? serverName : undefined,
      resolve: async() => ({ url: upstream.url, headers: {} }),
      metadata: async() => {},
    })
    const first = await manager.create({ musicInfo: fixtureTrack, quality: '128k', listId: 'server-list', listName: 'Browser Owned Escape' } as never)
    serverName = 'Renamed List'
    await manager.start(first.id)
    await manager.waitForIdle()
    expect(readFileSync(path.join(root, 'audio', '..RoadTrip', first.fileName))).toEqual(bytes)
    expect(() => readFileSync(path.join(root, 'audio', 'Browser Owned Escape', first.fileName))).toThrow()

    const second = await manager.create({ musicInfo: { ...fixtureTrack, id: 'second' }, quality: '128k', listId: 'server-list' })
    await manager.start(second.id)
    await manager.waitForIdle()
    expect(readFileSync(path.join(root, 'audio', 'Renamed List', second.fileName))).toEqual(bytes)

    const missing = await manager.create({ musicInfo: { ...fixtureTrack, id: 'missing' }, quality: '128k', listId: 'deleted-list' })
    await manager.start(missing.id)
    await manager.waitForIdle()
    expect(readFileSync(path.join(root, 'audio', 'Default', missing.fileName))).toEqual(bytes)
    manager.close()
  })
})

describe('local library ownership', () => {
  it('orders tracks by download time descending with a stable name tie-breaker', async() => {
    const root = createRoot()
    for (const name of ['Old.mp3', 'Zulu.mp3', 'Alpha.mp3']) {
      writeFileSync(path.join(root, 'audio', name), validMp3)
    }
    const timestamps: Record<string, number> = { 'Old.mp3': 1_000, 'Zulu.mp3': 3_000, 'Alpha.mp3': 3_000 }
    const scanner = new LibraryScanner(
      root,
      () => [path.join(root, 'audio')],
      () => undefined,
      undefined,
      filePath => timestamps[path.basename(filePath)],
    )

    const tracks = await scanner.refresh()

    expect(tracks.map(track => [track.name, track.downloadedAt])).toEqual([
      ['Alpha', 3_000],
      ['Zulu', 3_000],
      ['Old', 1_000],
    ])
  })

  it('backfills library resource URLs once and reuses the persisted result on refresh', async() => {
    const root = createRoot()
    const filePath = path.join(root, 'audio', 'fixture.mp3')
    writeFileSync(filePath, validMp3)
    let resourceParseCalls = 0
    const resources = new LibraryResourceStore(root, {
      parseFile: async() => {
        resourceParseCalls++
        return {
          common: {
            picture: [{ format: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }],
            lyrics: [{ text: '[00:01.00]Fixture lyric' }],
          },
          format: {},
          native: {},
          quality: { warnings: [] },
        } as never
      },
    })
    const scanner = new LibraryScanner(root, () => [path.join(root, 'audio')], () => undefined, resources)

    const [track] = await scanner.refresh()
    expect(track.pictureUrl).toBe(`/api/v1/library/tracks/${track.id}/picture`)
    expect(track.musicInfo.pic).toBe(track.pictureUrl)
    expect(track.lyricsUrl).toBe(`/api/v1/library/tracks/${track.id}/lyrics`)
    expect(track.musicInfo.meta.lyricsUrl).toBe(track.lyricsUrl)

    await scanner.refresh()
    expect(resourceParseCalls).toBe(1)
  })

  it('rejects a parseable downloaded file when its retained integrity no longer matches', async() => {
    const root = createRoot()
    const filePath = path.join(root, 'audio', 'Known.mp3')
    const original = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
    const integrity = { size: original.length, sha256: createHash('sha256').update(original).digest('hex') }
    writeFileSync(filePath, original)
    const scanner = new LibraryScanner(
      root,
      () => [path.join(root, 'audio')],
      candidate => candidate === realpathSync(filePath) ? integrity : undefined,
    )

    expect(await scanner.refresh()).toHaveLength(1)
    const damaged = Buffer.concat([original, Buffer.from('damage')])
    writeFileSync(filePath, damaged)

    expect(await scanner.refresh()).toEqual([])
    expect(readFileSync(filePath)).toEqual(damaged)
  })

  it('excludes a manually named file that is not parseable audio', async() => {
    const root = createRoot()
    const invalid = path.join(root, 'audio', 'Not Audio.mp3')
    writeFileSync(invalid, 'this is not audio')
    const scanner = new LibraryScanner(root, () => [path.join(root, 'audio')])

    expect(await scanner.refresh()).toEqual([])
    expect(readFileSync(invalid, 'utf8')).toBe('this is not audio')
  })

  it('ignores parts, returns path-opaque metadata DTOs, and owns all Range forms', async() => {
    const root = createRoot()
    writeFileSync(path.join(root, 'audio', 'fixture.mp3'), readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3')))
    writeFileSync(path.join(root, 'audio', 'ignored.mp3.part'), bytes)
    const scanner = new LibraryScanner(root, () => [path.join(root, 'audio')])
    const tracks = await scanner.refresh()
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ extension: 'mp3', streamUrl: `/api/v1/library/tracks/${tracks[0].id}/stream` })
    expect(JSON.stringify(tracks)).not.toContain(root)

    const app = Fastify()
    apps.push(app)
    registerLibraryRoutes(app, scanner)
    const full = await app.inject({ method: 'GET', url: tracks[0].streamUrl })
    const head = await app.inject({ method: 'HEAD', url: tracks[0].streamUrl })
    const open = await app.inject({ method: 'GET', url: tracks[0].streamUrl, headers: { range: 'bytes=10-' } })
    const suffix = await app.inject({ method: 'GET', url: tracks[0].streamUrl, headers: { range: 'bytes=-8' } })
    const invalid = await app.inject({ method: 'GET', url: tracks[0].streamUrl, headers: { range: 'bytes=999999-' } })
    expect([full.statusCode, head.statusCode, open.statusCode, suffix.statusCode, invalid.statusCode]).toEqual([200, 200, 206, 206, 416])
    expect(invalid.headers['content-range']).toBe(`bytes */${tracks[0].size}`)
  })
})
