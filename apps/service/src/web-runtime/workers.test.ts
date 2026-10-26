import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWebWorkers } from './workers'

const productionWorkerConsumers = async(): Promise<string[]> => {
  const operations = new Set<string>()
  const visit = async(directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      if (!entry.isFile() || !/\.(?:ts|js|vue)$/.test(entry.name) || /\.test\.(?:ts|js)$/.test(entry.name)) continue
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(/window\.tuneflow\.worker\.main\.([A-Za-z\d_]+)/g)) operations.add(match[1])
    }
  }
  await visit(path.join(process.cwd(), 'src/renderer'))
  return [...operations].sort()
}

const track = (id: string, name: string, singer = 'Artist', albumName = 'Album', interval = '03:00'): TuneFlow.Music.MusicInfo => ({
  id,
  name,
  singer,
  source: 'kw',
  interval,
  meta: { albumName },
})

describe('Web renderer workers', () => {
  it('implements the player filter operation used after failures and by Next', async() => {
    const first = { id: 'first', name: 'First', singer: 'Artist', meta: {} }
    const second = { id: 'second', name: 'Second', singer: 'Artist', meta: {} }
    const result = await createWebWorkers().main.filterMusicList({
      listId: 'default',
      list: [first, second],
      playedList: [{ listId: 'default', musicInfo: first, isTempPlay: false }],
      playerMusicInfo: first,
      dislikeInfo: { names: new Set(), musicNames: new Set(), singerNames: new Set() },
      isNext: true,
    } as any)

    expect(result.filteredList).toEqual([second])
    expect(result.canPlayList).toEqual([first, second])
  })

  it('rejects unsupported worker operations with UNSUPPORTED_CAPABILITY', async() => {
    await expect(createWebWorkers().download.writeMeta()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    })
  })

  it('sorts, finds duplicates, searches, and reorders lists in the Web runtime', async() => {
    const workers = createWebWorkers().main
    const alpha = track('alpha', 'Alpha (Live)', 'First', 'One', '04:05')
    const beta = track('beta', 'Beta', 'Second', 'Two', '02:10')
    const alphaStudio = track('alpha-studio', 'alpha', 'Third', 'Three', '03:20')

    await expect(workers.sortListMusicInfo([alpha, beta, alphaStudio], 'up', 'interval', 'en')).resolves
      .toEqual([beta, alphaStudio, alpha])
    await expect(workers.filterDuplicateMusic([alpha, beta, alphaStudio])).resolves.toEqual([
      { id: 'alpha', index: 0, musicInfo: alpha },
      { id: 'alpha-studio', index: 2, musicInfo: alphaStudio },
    ])
    expect(workers.searchListMusic([alpha, beta, alphaStudio], 'second')).toEqual([beta])
    expect(workers.createSortedList([alpha, beta, alphaStudio], 1, ['alpha-studio', 'alpha'])).toEqual([
      beta,
      alphaStudio,
      alpha,
    ])
  })

  it('provides a real adapter operation for every production main-worker consumer', async() => {
    expect(await productionWorkerConsumers()).toEqual(Object.keys(createWebWorkers().main).sort())
  })

  it('boots the renderer from the Web worker adapter', async() => {
    const source = await readFile(path.join(process.cwd(), 'src/renderer/core/globalData.ts'), 'utf8')

    expect(source).toContain("from '@web-runtime/workers'")
    expect(source).not.toContain("from '@renderer/worker'")
  })

  it('does not initialize the deleted renderer worker tree', async() => {
    const source = await readFile(path.join(process.cwd(), 'src/renderer/main.ts'), 'utf8')

    expect(source).not.toContain("import './worker'")
  })
})
