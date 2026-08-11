import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

const productionFiles = async(roots: string[]): Promise<string[]> => {
  const files: string[] = []
  const visit = async(directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      if (!entry.isFile() || !/\.(?:ts|js|mjs|cjs)$/.test(entry.name) || /\.test\.(?:ts|js|mjs|cjs)$/.test(entry.name)) continue
      files.push(file)
    }
  }
  await Promise.all(roots.map(async root => visit(path.resolve(root))))
  return files
}

it('does not import Electron-owned source trees', async() => {
  const files = await productionFiles(['src/server'])
  for (const file of files) {
    expect(await readFile(file, 'utf8')).not.toMatch(/(?:@main|src\/main|\.\.\/main\/)/)
  }
})
