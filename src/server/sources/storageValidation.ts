import { existsSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

interface SourceDatabase {
  prepare: (sql: string) => { all: () => unknown[] }
}

export const validateInstalledSourceFiles = (database: SourceDatabase, sourceRoot: string): void => {
  const root = realpathSync(sourceRoot)
  const rows = database.prepare('SELECT id FROM web_sources').all() as Array<{ id: string }>
  for (const row of rows) {
    const hash = /^user_api_([a-f0-9]{64})$/.exec(row.id)?.[1]
    if (hash == null) throw new Error(`Invalid installed source id: ${row.id}`)
    const expected = path.join(root, `${hash}.js`)
    if (!existsSync(expected) || !lstatSync(expected).isFile() || realpathSync(path.dirname(expected)) !== root) {
      throw new Error(`Installed source script is missing: ${hash}.js`)
    }
  }
}
