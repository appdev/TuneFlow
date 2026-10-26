import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../app'
import { writeAudioMetadata } from '../downloads/taglibMetadata'

const roots: string[] = []
const apps: Array<Awaited<ReturnType<typeof createServer>>> = []
const fixtureAudio = path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

const createTestServer = async(files: Array<{ name: string, bytes?: Buffer }> = [{ name: 'fixture.mp3' }]) => {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-library-resources-'))
  const audioRoot = path.join(storageRoot, 'audio')
  const webRoot = path.join(storageRoot, 'web')
  mkdirSync(audioRoot)
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>TuneFlow</title>')
  for (const file of files) writeFileSync(path.join(audioRoot, file.name), file.bytes ?? readFileSync(fixtureAudio))
  roots.push(storageRoot)
  return {
    storageRoot,
    audioRoot,
    start: async() => {
      const app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
      apps.push(app)
      return app
    },
  }
}

const firstTrackId = async(app: Awaited<ReturnType<typeof createServer>>): Promise<string> => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })
  return response.json().data[0].id as string
}

afterEach(async() => {
  for (const app of apps.splice(0)) await app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local library resources', () => {
  it('returns embedded picture bytes and prefers embedded lyrics over a sidecar', async() => {
    const fixture = await createTestServer()
    const audioPath = path.join(fixture.audioRoot, 'fixture.mp3')
    await writeAudioMetadata(audioPath, {
      title: 'fixture',
      picture: png,
      pictureMimeType: 'image/png',
      lyrics: '[00:01.00]Embedded lyric',
    })
    writeFileSync(path.join(fixture.audioRoot, 'fixture.lrc'), '[00:01.00]Sidecar lyric')
    const app = await fixture.start()
    const listing = await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })
    const track = listing.json().data[0] as {
      id: string
      pictureUrl?: string
      lyricsUrl?: string
      musicInfo: { pic?: string, meta: { lyricsUrl?: string } }
    }
    const id = track.id

    const picture = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${id}/picture` })
    const pictureHead = await app.inject({ method: 'HEAD', url: `/api/v1/library/tracks/${id}/picture` })
    const lyrics = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${id}/lyrics` })

    expect(track.pictureUrl).toBe(`/api/v1/library/tracks/${id}/picture`)
    expect(track.musicInfo.pic).toBe(track.pictureUrl)
    expect(track.lyricsUrl).toBe(`/api/v1/library/tracks/${id}/lyrics`)
    expect(track.musicInfo.meta.lyricsUrl).toBe(track.lyricsUrl)
    expect(picture.statusCode).toBe(200)
    expect(picture.headers['content-type']).toBe('image/png')
    expect(picture.headers['content-length']).toBe(String(png.length))
    expect(picture.headers.etag).toMatch(/^"[a-f0-9]{64}"$/)
    expect(picture.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(picture.rawPayload).toEqual(png)
    expect(pictureHead.statusCode).toBe(200)
    expect(pictureHead.headers['content-length']).toBe(String(png.length))
    expect(pictureHead.rawPayload).toHaveLength(0)
    expect(lyrics.statusCode).toBe(200)
    expect(lyrics.json()).toEqual({ data: { lyric: '[00:01.00]Embedded lyric' } })
  })

  it('reads UTF-8 BOM sidecars and invalidates the cached lyric when the sidecar signature changes', async() => {
    const fixture = await createTestServer()
    const sidecarPath = path.join(fixture.audioRoot, 'fixture.lrc')
    writeFileSync(sidecarPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[00:01.00]First lyric')]))
    const app = await fixture.start()
    const id = await firstTrackId(app)

    const first = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${id}/lyrics` })
    expect(first.json()).toEqual({ data: { lyric: '[00:01.00]First lyric' } })

    writeFileSync(sidecarPath, '[00:02.00]Changed lyric')
    const changedTime = new Date(Date.now() + 2_000)
    utimesSync(sidecarPath, changedTime, changedTime)
    await app.inject({ method: 'POST', url: '/api/v1/library/scan' })
    const second = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${id}/lyrics` })
    expect(second.json()).toEqual({ data: { lyric: '[00:02.00]Changed lyric' } })
  })

  it('deletes the audio, sidecar, derived resources, index, and publishes the new library snapshot', async() => {
    const fixture = await createTestServer()
    const audioPath = path.join(fixture.audioRoot, 'fixture.mp3')
    const sidecarPath = path.join(fixture.audioRoot, 'fixture.lrc')
    await writeAudioMetadata(audioPath, {
      title: 'fixture',
      picture: png,
      pictureMimeType: 'image/png',
    })
    writeFileSync(sidecarPath, '[00:01.00]Sidecar lyric')
    const app = await fixture.start()
    const id = await firstTrackId(app)
    const picturePath = path.join(fixture.storageRoot, 'cover', 'fixture.mp3.png')
    const lyricsPath = path.join(fixture.storageRoot, 'lyrics', 'fixture.mp3.lrc')
    const indexRoot = path.join(fixture.storageRoot, 'library-resource-index')
    expect(existsSync(picturePath)).toBe(true)
    expect(existsSync(lyricsPath)).toBe(true)
    expect(readdirSync(indexRoot).filter(name => name.endsWith('.json'))).toHaveLength(1)

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/library/tracks/${id}` })

    expect(deleted.statusCode).toBe(204)
    expect(existsSync(audioPath)).toBe(false)
    expect(existsSync(sidecarPath)).toBe(false)
    expect(existsSync(picturePath)).toBe(false)
    expect(existsSync(lyricsPath)).toBe(false)
    expect(readdirSync(indexRoot).filter(name => name.endsWith('.json'))).toHaveLength(0)
    expect((await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })).json()).toEqual({ data: [] })
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/events/snapshot' })).json().data as {
      events: Array<{ type: string, data: unknown }>
    }
    expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'library.updated', data: [] }))

    const repeated = await app.inject({ method: 'DELETE', url: `/api/v1/library/tracks/${id}` })
    expect(repeated.statusCode).toBe(404)
    expect(repeated.json()).toEqual({ error: { code: 'LIBRARY_TRACK_NOT_FOUND', message: 'Library track not found' } })
  })

  it('keeps a sidecar while another audio variant with the same basename still uses it', async() => {
    const fixture = await createTestServer([
      { name: 'shared.mp3', bytes: readFileSync(fixtureAudio) },
      { name: 'shared.wav', bytes: readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/filters/filter-telephone.wav')) },
    ])
    const sidecarPath = path.join(fixture.audioRoot, 'shared.lrc')
    writeFileSync(sidecarPath, '[00:01.00]Shared lyric')
    const app = await fixture.start()
    const tracks = (await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })).json().data as Array<{
      id: string
      extension: string
      lyricsUrl: string
    }>
    expect(tracks).toHaveLength(2)
    const mp3 = tracks.find(track => track.extension === 'mp3')!
    const wav = tracks.find(track => track.extension === 'wav')!

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/library/tracks/${mp3.id}` })).statusCode).toBe(204)
    expect(existsSync(sidecarPath)).toBe(true)
    expect((await app.inject({ method: 'GET', url: wav.lyricsUrl })).json()).toEqual({ data: { lyric: '[00:01.00]Shared lyric' } })

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/library/tracks/${wav.id}` })).statusCode).toBe(204)
    expect(existsSync(sidecarPath)).toBe(false)
  })

  it('returns resource-specific 404 errors without leaking paths and rejects unknown ids', async() => {
    const fixture = await createTestServer([
      { name: 'empty-1.mp3', bytes: readFileSync(fixtureAudio) },
      { name: 'empty-2.mp3', bytes: readFileSync(fixtureAudio) },
      { name: 'empty-3.mp3', bytes: readFileSync(fixtureAudio) },
      { name: 'empty-4.mp3', bytes: readFileSync(fixtureAudio) },
    ])
    const app = await fixture.start()
    const tracks = (await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })).json().data as Array<{ id: string }>
    expect(tracks).toHaveLength(4)

    for (const track of tracks) {
      const picture = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${track.id}/picture` })
      const lyrics = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${track.id}/lyrics` })
      expect(picture.statusCode).toBe(404)
      expect(picture.json()).toEqual({ error: { code: 'LIBRARY_TRACK_PICTURE_NOT_FOUND', message: 'Library track picture not found' } })
      expect(lyrics.statusCode).toBe(404)
      expect(lyrics.json()).toEqual({ error: { code: 'LIBRARY_TRACK_LYRICS_NOT_FOUND', message: 'Library track lyrics not found' } })
    }

    for (const resource of ['picture', 'lyrics']) {
      const unknown = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/attacker-chosen-id/${resource}` })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toEqual({ error: { code: 'LIBRARY_TRACK_NOT_FOUND', message: 'Library track not found' } })
      expect(unknown.body).not.toContain(fixture.storageRoot)
    }
  })
})
