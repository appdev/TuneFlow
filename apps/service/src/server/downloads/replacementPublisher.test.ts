import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReplacementConflictError, ReplacementPublisher } from './replacementPublisher'

const roots: string[] = []
const root = () => { const value = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-replace-')); roots.push(value); return value }
const integrity = (value: Buffer) => ({ size: value.length, sha256: createHash('sha256').update(value).digest('hex') })

afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }) })

describe('replacement publisher', () => {
  it('atomically replaces the original path after verifying both files', () => {
    const directory = root()
    const original = path.join(directory, 'Song.mp3')
    const staged = path.join(directory, 'staged.part')
    const oldBytes = Buffer.from('old')
    const newBytes = Buffer.from('new')
    writeFileSync(original, oldBytes)
    writeFileSync(staged, newBytes)
    const phases: string[] = []

    new ReplacementPublisher().publish({
      originalPath: original,
      stagedPath: staged,
      finalPath: original,
      originalIntegrity: integrity(oldBytes),
      replacementIntegrity: integrity(newBytes),
      phase: 'prepared',
      onPhase: phase => { phases.push(phase) },
    })

    expect(readFileSync(original)).toEqual(newBytes)
    expect(existsSync(staged)).toBe(false)
    expect(phases).toEqual(['published', 'retired'])
  })

  it('publishes a new format before retiring the verified old format and sidecar', () => {
    const directory = root()
    const original = path.join(directory, 'Song.mp3')
    const final = path.join(directory, 'Song.flac')
    const staged = path.join(directory, 'staged.part')
    const stagedLyric = path.join(directory, 'staged.lrc')
    const oldBytes = Buffer.from('old')
    const newBytes = Buffer.from('new')
    writeFileSync(original, oldBytes)
    writeFileSync(path.join(directory, 'Song.lrc'), 'old lyric')
    writeFileSync(staged, newBytes)
    writeFileSync(stagedLyric, 'new lyric')

    new ReplacementPublisher().publish({
      originalPath: original,
      stagedPath: staged,
      finalPath: final,
      originalIntegrity: integrity(oldBytes),
      replacementIntegrity: integrity(newBytes),
      stagedLyricPath: stagedLyric,
      finalLyricPath: path.join(directory, 'Song.lrc'),
      phase: 'prepared',
      onPhase: () => {},
    })

    expect(readFileSync(final)).toEqual(newBytes)
    expect(readFileSync(path.join(directory, 'Song.lrc'), 'utf8')).toBe('new lyric')
    expect(existsSync(original)).toBe(false)
  })

  it('recovers a rename that happened before the published marker persisted', () => {
    const directory = root()
    const original = path.join(directory, 'Song.mp3')
    const final = path.join(directory, 'Song.flac')
    const staged = path.join(directory, 'staged.part')
    const oldBytes = Buffer.from('old')
    const newBytes = Buffer.from('new')
    writeFileSync(original, oldBytes)
    writeFileSync(final, newBytes)

    const phase = new ReplacementPublisher().recover({
      originalPath: original,
      stagedPath: staged,
      finalPath: final,
      originalIntegrity: integrity(oldBytes),
      replacementIntegrity: integrity(newBytes),
      phase: 'prepared',
      onPhase: () => {},
    })

    expect(phase).toBe('retired')
    expect(existsSync(original)).toBe(false)
    expect(readFileSync(final)).toEqual(newBytes)
  })

  it('never overwrites a changed original or unrelated destination', () => {
    const directory = root()
    const original = path.join(directory, 'Song.mp3')
    const staged = path.join(directory, 'staged.part')
    const final = path.join(directory, 'Song.flac')
    const oldBytes = Buffer.from('old')
    const newBytes = Buffer.from('new')
    writeFileSync(original, Buffer.from('externally changed'))
    writeFileSync(staged, newBytes)
    writeFileSync(final, Buffer.from('unrelated'))

    expect(() => new ReplacementPublisher().publish({
      originalPath: original,
      stagedPath: staged,
      finalPath: final,
      originalIntegrity: integrity(oldBytes),
      replacementIntegrity: integrity(newBytes),
      phase: 'prepared',
      onPhase: () => {},
    })).toThrow(ReplacementConflictError)
    expect(readFileSync(original, 'utf8')).toBe('externally changed')
    expect(readFileSync(final, 'utf8')).toBe('unrelated')
  })
})
