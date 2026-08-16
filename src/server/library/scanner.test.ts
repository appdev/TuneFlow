import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAudioMetadata } from '../downloads/taglibMetadata'
import { LibraryResourceStore } from './resources'
import { LibraryScanner } from './scanner'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('library scanner resource matching', () => {
  it('returns embedded resources for a matching online track without exposing paths', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-scanner-'))
    roots.push(root)
    const audioRoot = path.join(root, 'audio')
    mkdirSync(audioRoot, { recursive: true })
    const audio = path.join(audioRoot, 'Fixture - Artist.mp3')
    copyFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'), audio)
    const picture = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    await writeAudioMetadata(audio, {
      title: 'Fixture',
      artist: 'Artist',
      lyrics: '[00:01.00]embedded',
      picture,
      pictureMimeType: 'image/png',
    })
    const resources = new LibraryResourceStore(root)
    const scanner = new LibraryScanner(root, () => [audioRoot], () => undefined, resources)

    const matched = await scanner.readMatchingResources({ id: 'online-1', name: 'Fixture', singer: 'Artist', source: 'tx' })

    expect(matched?.lyrics?.lyric).toBe('[00:01.00]embedded')
    expect(matched?.picture?.mimeType).toBe('image/png')
    expect(matched?.picture?.bytes).toEqual(picture)
    expect(JSON.stringify(matched)).not.toContain(root)
  })
})
