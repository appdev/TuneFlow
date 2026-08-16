import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import defaultSetting from '../../common/defaultSetting'
import { writeAudioMetadata } from '../downloads/taglibMetadata'
import { LibraryMetadataEnricher } from './metadataEnricher'

const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = async(): Promise<{ root: string, audio: string }> => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-enrich-'))
  roots.push(root)
  const audioRoot = path.join(root, 'audio')
  mkdirSync(audioRoot, { recursive: true })
  const audio = path.join(audioRoot, 'fixture.mp3')
  copyFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'), audio)
  await writeAudioMetadata(audio, { title: 'Fixture', picture: png, pictureMimeType: 'image/png' })
  return { root, audio }
}

describe('library metadata enricher', () => {
  it('atomically fills missing lyrics while preserving existing artwork', async() => {
    const { root, audio } = await fixture()
    const enricher = new LibraryMetadataEnricher(path.join(root, 'audio'))

    const result = await enricher.enrich(audio, { lyrics: { lyric: '[00:01.00]late lyric' } }, {
      ...defaultSetting,
      'download.isEmbedPic': true,
      'download.isEmbedLyric': true,
      'download.isDownloadLrc': false,
    })
    const parsed = await parseFile(audio)

    expect(result.changed).toEqual(['lyrics'])
    expect(parsed.common.picture?.[0].data).toEqual(Uint8Array.from(png))
    expect(parsed.common.lyrics?.some(value => value.text === '[00:01.00]late lyric')).toBe(true)
    expect(readdirSync(path.dirname(audio)).some(name => name.endsWith('.tuneflowtmp'))).toBe(false)
  })

  it('does not replace existing embedded lyrics', async() => {
    const { root, audio } = await fixture()
    await writeAudioMetadata(audio, { title: 'Fixture', lyrics: '[00:01.00]existing lyric' })
    const enricher = new LibraryMetadataEnricher(path.join(root, 'audio'))

    const result = await enricher.enrich(audio, { lyrics: { lyric: '[00:01.00]replacement lyric' } }, {
      ...defaultSetting,
      'download.isEmbedLyric': true,
      'download.isDownloadLrc': false,
    })
    const parsed = await parseFile(audio)

    expect(result.changed).toEqual([])
    expect(parsed.common.lyrics?.some(value => value.text === '[00:01.00]existing lyric')).toBe(true)
    expect(existsSync(`${audio}.tuneflowtmp`)).toBe(false)
  })

  it('keeps the original audio when sidecar publication fails', async() => {
    const { root, audio } = await fixture()
    const original = readFileSync(audio)
    let syncCalls = 0
    const enricher = new LibraryMetadataEnricher(path.join(root, 'audio'), {
      syncDirectory: () => {
        syncCalls++
        if (syncCalls === 1) throw new Error('sidecar publication failed')
      },
    })

    await expect(enricher.enrich(audio, { lyrics: { lyric: '[00:01.00]late lyric' } }, {
      ...defaultSetting,
      'download.isEmbedLyric': true,
      'download.isDownloadLrc': true,
    })).rejects.toThrow('sidecar publication failed')

    expect(readFileSync(audio)).toEqual(original)
    expect(existsSync(audio.replace(/\.mp3$/, '.lrc'))).toBe(false)
    expect(readdirSync(path.dirname(audio)).some(name => name.includes('.tuneflowtmp'))).toBe(false)
  })

  it('rolls back audio and its new sidecar when managed publication throws after replacement', async() => {
    const { root, audio } = await fixture()
    const original = readFileSync(audio)
    let calls = 0
    const enricher = new LibraryMetadataEnricher(path.join(root, 'audio'), {
      publish: input => {
        calls++
        if (calls === 1) {
          renameSync(input.stagedPath, input.targetPath)
          throw new Error('managed publication failed after replacement')
        }
        throw new Error('managed rollback publication failed')
      },
    })

    await expect(enricher.enrich(audio, { lyrics: { lyric: '[00:01.00]late lyric' } }, {
      ...defaultSetting,
      'download.isEmbedLyric': true,
      'download.isDownloadLrc': true,
    })).rejects.toThrow('managed publication failed after replacement')

    expect(calls).toBe(2)
    expect(readFileSync(audio)).toEqual(original)
    expect(existsSync(audio.replace(/\.mp3$/, '.lrc'))).toBe(false)
    expect(readdirSync(path.dirname(audio)).some(name => name.includes('.tuneflowtmp'))).toBe(false)
  })
})
