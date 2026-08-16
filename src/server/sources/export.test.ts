import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { close as closeDatabase, init as initDatabase } from '../db/core/db'
import { prepareSourceExport, sourceExportArchiveName } from './export'
import { SourceRepository } from './repository'
import type { SourceExportSource } from './types'

const roots: string[] = []

const script = (name: string, version: string) => `/*
 * @name ${name}
 * @version ${version}
 */
window.tuneflow.send()
`

const source = (idChar: string, name: string, version: string, scriptPath: string): SourceExportSource => ({
  id: `user_api_${idChar.repeat(64)}`,
  name,
  version,
  scriptPath,
})

const temporarySourceRoot = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-source-export-'))
  roots.push(root)
  const sourceRoot = path.join(root, 'sources')
  mkdirSync(sourceRoot)
  return sourceRoot
}

afterEach(() => {
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source script export preparation', () => {
  it('lists only registered source scripts in installation order', async() => {
    const sourceRoot = temporarySourceRoot()
    const storageRoot = path.dirname(sourceRoot)
    initDatabase(storageRoot)
    const repository = new SourceRepository(storageRoot)
    await repository.installSource(script('First source', '1.0.0'))
    await repository.installSource(script('Second source', '2.0.0'))
    writeFileSync(path.join(sourceRoot, '.orphan.js'), 'orphan')

    const inventory = repository.listSourceExportFiles()

    expect(inventory.map(({ name, version }) => ({ name, version }))).toEqual([
      { name: 'First source', version: '1.0.0' },
      { name: 'Second source', version: '2.0.0' },
    ])
    expect(inventory.every(item => item.scriptPath.endsWith(`${item.id.slice('user_api_'.length)}.js`))).toBe(true)
    expect(inventory.some(item => item.scriptPath.endsWith('.orphan.js'))).toBe(false)
    expect(repository.getSourceRoot()).toBe(sourceRoot)
  })

  it('builds a stable archive filename from UTC time', () => {
    expect(sourceExportArchiveName(new Date('2026-08-16T03:04:05Z')))
      .toBe('tuneflow-sources-20260816-030405.zip')
  })

  it('creates portable unique root entry names without changing file bytes', () => {
    const sourceRoot = temporarySourceRoot()
    const firstPath = path.join(sourceRoot, 'first.js')
    const secondPath = path.join(sourceRoot, 'second.js')
    writeFileSync(firstPath, 'first bytes')
    writeFileSync(secondPath, 'second bytes')

    const entries = prepareSourceExport([
      source('a', ' A/B:*? ', 'v1.', firstPath),
      source('b', 'A\\B:*?', 'v1', secondPath),
    ], sourceRoot)

    expect(entries.map(({ archiveName, size }) => ({ archiveName, size }))).toEqual([
      { archiveName: 'A_B___-v1.js', size: 11 },
      { archiveName: 'A_B___-v1-bbbbbbbb.js', size: 12 },
    ])
    expect(entries.map(entry => entry.scriptPath)).toEqual([realpathSync(firstPath), realpathSync(secondPath)])
  })

  it('bounds and sanitizes hostile or empty portable names', () => {
    const sourceRoot = temporarySourceRoot()
    const paths = ['empty', 'long', 'control'].map(name => path.join(sourceRoot, `${name}.js`))
    paths.forEach(filePath => { writeFileSync(filePath, 'x') })

    const entries = prepareSourceExport([
      source('a', ' ... ', '', paths[0]),
      source('b', '乐'.repeat(180), '', paths[1]),
      source('c', '../bad\u0000name', '', paths[2]),
    ], sourceRoot)

    expect(entries[0].archiveName).toBe('source.js')
    expect(Array.from(entries[1].archiveName.slice(0, -3))).toHaveLength(120)
    expect(entries[2].archiveName).toBe('_bad_name.js')
    expect(entries.every(entry => Array.from(entry.archiveName).every(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return character !== '/' && character !== '\\' && codePoint > 31 && codePoint !== 127
    }))).toBe(true)
  })

  it('extends colliding hash prefixes until every duplicate name is unique', () => {
    const sourceRoot = temporarySourceRoot()
    const paths = ['first', 'second', 'third'].map(name => path.join(sourceRoot, `${name}.js`))
    paths.forEach(filePath => { writeFileSync(filePath, 'x') })

    const entries = prepareSourceExport([
      { id: `user_api_${'a'.repeat(64)}`, name: 'Duplicate', version: '1', scriptPath: paths[0] },
      { id: `user_api_aaaaaaaa${'b'.repeat(56)}`, name: 'Duplicate', version: '1', scriptPath: paths[1] },
      { id: `user_api_aaaaaaaa${'c'.repeat(56)}`, name: 'Duplicate', version: '1', scriptPath: paths[2] },
    ], sourceRoot)

    expect(entries.map(entry => entry.archiveName)).toEqual([
      'Duplicate-1.js',
      'Duplicate-1-aaaaaaaa.js',
      'Duplicate-1-aaaaaaaacccc.js',
    ])
  })

  it('rejects empty, missing, non-file, and out-of-root inventories without leaking paths', () => {
    const sourceRoot = temporarySourceRoot()
    const directoryPath = path.join(sourceRoot, 'directory.js')
    const outsidePath = path.join(path.dirname(sourceRoot), 'outside.js')
    mkdirSync(directoryPath)
    writeFileSync(outsidePath, 'outside')

    expect(() => prepareSourceExport([], sourceRoot)).toThrow(expect.objectContaining({ code: 'SOURCE_EXPORT_EMPTY' }))
    for (const scriptPath of [path.join(sourceRoot, 'missing.js'), directoryPath, outsidePath]) {
      let failure: unknown
      try { prepareSourceExport([source('a', 'Fixture', '1', scriptPath)], sourceRoot) } catch (error) { failure = error }
      expect(failure).toMatchObject({ code: 'SOURCE_EXPORT_FAILED', message: 'Unable to export installed sources' })
      expect(String((failure as Error).message)).not.toContain(scriptPath)
    }
  })
})
