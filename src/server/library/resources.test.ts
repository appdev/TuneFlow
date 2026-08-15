/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LibraryResourceStore } from './resources'

const roots: string[] = []
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const createRoot = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-library-resources-'))
  roots.push(root)
  for (const name of ['audio', 'cover', 'lyrics', 'tmp', 'library-resource-index']) {
    mkdirSync(path.join(root, name), { recursive: true })
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('LibraryResourceStore', () => {
  it('persists mirrored embedded resources and reuses them after restart', async() => {
    const root = createRoot()
    const audio = path.join(root, 'audio', '歌单A', '123.mp3')
    mkdirSync(path.dirname(audio), { recursive: true })
    writeFileSync(audio, 'audio')
    let parseCalls = 0
    const store = new LibraryResourceStore(root, {
      parseFile: async() => {
        parseCalls++
        return {
          common: {
            picture: [{ format: 'image/jpeg', data: jpeg }],
            lyrics: [{ text: '\ufeff[00:01.00]Embedded lyric' }],
          },
          format: {},
          native: {},
          quality: { warnings: [] },
        } as never
      },
    })

    const first = await store.ensure(audio)

    expect(first.picture).toMatchObject({
      relativePath: 'cover/歌单A/123.mp3.jpg',
      mimeType: 'image/jpeg',
      byteLength: jpeg.length,
    })
    expect(first.lyrics).toMatchObject({
      relativePath: 'lyrics/歌单A/123.mp3.lrc',
    })
    expect(readFileSync(first.picture!.filePath)).toEqual(jpeg)
    expect(readFileSync(first.lyrics!.filePath, 'utf8')).toBe('[00:01.00]Embedded lyric')
    expect(parseCalls).toBe(1)

    const restarted = new LibraryResourceStore(root, {
      parseFile: async() => { throw new Error('persisted resource must not reparse audio') },
    })
    const cached = await restarted.ensure(audio)

    expect(cached.picture).toMatchObject({ relativePath: 'cover/歌单A/123.mp3.jpg' })
    expect(cached.lyrics).toMatchObject({ relativePath: 'lyrics/歌单A/123.mp3.lrc' })
  })

  it('persists missing-resource results and reparses only after the audio signature changes', async() => {
    const root = createRoot()
    const audio = path.join(root, 'audio', 'empty.mp3')
    writeFileSync(audio, 'audio')
    let parseCalls = 0
    const store = new LibraryResourceStore(root, {
      parseFile: async() => {
        parseCalls++
        return { common: {}, format: {}, native: {}, quality: { warnings: [] } } as never
      },
    })

    expect(await store.ensure(audio)).toEqual({})
    expect(await store.ensure(audio)).toEqual({})
    expect(parseCalls).toBe(1)

    writeFileSync(audio, 'changed audio bytes')
    const changed = new Date(Date.now() + 2_000)
    utimesSync(audio, changed, changed)
    expect(await store.ensure(audio)).toEqual({})
    expect(parseCalls).toBe(2)
  })

  it('refreshes a derived sidecar lyric when the sidecar signature changes', async() => {
    const root = createRoot()
    const audio = path.join(root, 'audio', 'sidecar.mp3')
    const sidecar = path.join(root, 'audio', 'sidecar.lrc')
    writeFileSync(audio, 'audio')
    writeFileSync(sidecar, '\ufeff[00:01.00]First lyric')
    let parseCalls = 0
    const store = new LibraryResourceStore(root, {
      parseFile: async() => {
        parseCalls++
        return { common: {}, format: {}, native: {}, quality: { warnings: [] } } as never
      },
    })

    const first = await store.ensure(audio)
    expect(readFileSync(first.lyrics!.filePath, 'utf8')).toBe('[00:01.00]First lyric')

    writeFileSync(sidecar, '[00:02.00]Changed lyric')
    const changed = new Date(Date.now() + 2_000)
    utimesSync(sidecar, changed, changed)
    const refreshed = await store.ensure(audio)

    expect(readFileSync(refreshed.lyrics!.filePath, 'utf8')).toBe('[00:02.00]Changed lyric')
    expect(parseCalls).toBe(2)
  })

  it('keeps audio extensions in derived names and reconciles only orphaned resources', async() => {
    const root = createRoot()
    const mp3 = path.join(root, 'audio', '123.mp3')
    const flac = path.join(root, 'audio', '123.flac')
    writeFileSync(mp3, 'mp3')
    writeFileSync(flac, 'flac')
    const store = new LibraryResourceStore(root, {
      parseFile: async(filePath) => ({
        common: {
          picture: [{
            format: filePath.endsWith('.mp3') ? 'image/jpeg' : 'image/png',
            data: filePath.endsWith('.mp3') ? jpeg : png,
          }],
        },
        format: {},
        native: {},
        quality: { warnings: [] },
      }) as never,
    })

    const mp3Resources = await store.ensure(mp3)
    const flacResources = await store.ensure(flac)
    expect(mp3Resources.picture?.relativePath).toBe('cover/123.mp3.jpg')
    expect(flacResources.picture?.relativePath).toBe('cover/123.flac.png')

    rmSync(mp3)
    await store.reconcile(new Set([flac]))

    expect(existsSync(mp3Resources.picture!.filePath)).toBe(false)
    expect(existsSync(flacResources.picture!.filePath)).toBe(true)
    expect(statSync(flac).isFile()).toBe(true)
  })
})
