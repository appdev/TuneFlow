import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFile } from 'music-metadata'
import { addMissingAudioMetadata, writeAudioMetadata } from './taglibMetadata'
import { apeFixture } from './apeFixture.testData'

const roots: string[] = []
const minimalFlac = (): Buffer => Buffer.from('ZkxhQwAAACISABIAAAAOAAAQCsRC8AAArETSsSAZkBm2OdWn4rNGPpyXhAAALg0AAABMYXZmNjIuMTIuMTAyAQAAABUAAABlbmNvZGVyPUxhdmY2Mi4xMi4xMDL/+FkYAGsAAAAAAAAQiv/4WRgBbAAAAAAAAIf///hZGAJlAAAAAAAAvmX/+FkYA2IAAAAAAAApEP/4WRgEdwAAAAAAAM1R//hZGAVwAAAAAAAAWiT/+FkYBnkAAAAAAABjvv/4WRgHfgAAAAAAAPTL//hZGAhTAAAAAAAAKzn/+HkYCQpDcAAAAAAAAJiF', 'base64')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

const minimalWav = (): Buffer => {
  const sampleBytes = 8_000 * 2
  const value = Buffer.alloc(44 + sampleBytes)
  value.write('RIFF', 0)
  value.writeUInt32LE(value.length - 8, 4)
  value.write('WAVEfmt ', 8)
  value.writeUInt32LE(16, 16)
  value.writeUInt16LE(1, 20)
  value.writeUInt16LE(1, 22)
  value.writeUInt32LE(8_000, 24)
  value.writeUInt32LE(16_000, 28)
  value.writeUInt16LE(2, 32)
  value.writeUInt16LE(16, 34)
  value.write('data', 36)
  value.writeUInt32LE(sampleBytes, 40)
  return value
}

const createFile = (name: string, bytes: Uint8Array): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-taglib-'))
  roots.push(root)
  const filePath = path.join(root, name)
  writeFileSync(filePath, bytes)
  return filePath
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('TagLib-Wasm audio metadata writer', () => {
  it.each([
    ['mp3', () => readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))],
    ['flac', minimalFlac],
    ['ape', () => Buffer.from(apeFixture)],
    ['wav', minimalWav],
  ] as const)('persists basic tags, front cover, and lyrics into a real %s container', async(extension, fixture) => {
    const filePath = createFile(`fixture.${extension}`, fixture())

    await writeAudioMetadata(filePath, {
      title: 'Fixture title',
      artist: 'Fixture artist',
      album: 'Fixture album',
      picture: png,
      pictureMimeType: 'image/png',
      lyrics: '[00:01.00]Fixture lyric',
    })

    const parsed = await parseFile(filePath)
    expect(parsed.common).toMatchObject({
      title: 'Fixture title',
      artist: 'Fixture artist',
      album: 'Fixture album',
      lyrics: expect.anything(),
      picture: [expect.objectContaining({ format: 'image/png' })],
    })
  })

  it('rejects an invalid FLAC instead of silently succeeding', async() => {
    const filePath = createFile('invalid.flac', Buffer.from('not flac'))

    await expect(writeAudioMetadata(filePath, { title: 'Invalid' })).rejects.toThrow()
  })

  it('fills only missing lyrics and preserves an existing picture', async() => {
    const filePath = createFile('fixture.mp3', readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3')))
    await writeAudioMetadata(filePath, { title: 'Fixture', picture: png, pictureMimeType: 'image/png' })

    const changed = await addMissingAudioMetadata(filePath, { lyrics: '[00:01.00]new lyric' })
    const parsed = await parseFile(filePath)

    expect(changed).toEqual(['lyrics'])
    expect(parsed.common.picture?.[0].data).toEqual(Uint8Array.from(png))
    expect(parsed.common.lyrics?.some(value => value.text === '[00:01.00]new lyric')).toBe(true)
  })

  it('does not replace existing lyrics or artwork', async() => {
    const filePath = createFile('fixture.mp3', readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3')))
    await writeAudioMetadata(filePath, {
      title: 'Fixture',
      picture: png,
      pictureMimeType: 'image/png',
      lyrics: '[00:01.00]existing lyric',
    })

    const changed = await addMissingAudioMetadata(filePath, {
      picture: Uint8Array.of(9, 8, 7),
      pictureMimeType: 'image/png',
      lyrics: '[00:01.00]replacement lyric',
    })
    const parsed = await parseFile(filePath)

    expect(changed).toEqual([])
    expect(parsed.common.picture?.[0].data).toEqual(Uint8Array.from(png))
    expect(parsed.common.lyrics?.some(value => value.text === '[00:01.00]existing lyric')).toBe(true)
  })
})
