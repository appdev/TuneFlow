import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getDB } from '../db/core/db'
import { parseSourceScript } from './parser'
import { SourceServiceError, type InstalledSource, type SourceSummary } from './types'

interface SourceRow extends Omit<InstalledSource, 'sources'> {
  sources: string | null
}

export class SourceRepository {
  private readonly sourceDir: string

  constructor(storageRoot: string) {
    this.sourceDir = path.join(storageRoot, 'sources')
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS web_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        author TEXT NOT NULL,
        homepage TEXT NOT NULL,
        script_path TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        sources_json TEXT
      );
      CREATE TABLE IF NOT EXISTS web_source_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        active_source_id TEXT REFERENCES web_sources(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO web_source_state (singleton, active_source_id) VALUES (1, NULL);
    `)
  }

  private activeId(): string | null {
    const state = getDB().prepare('SELECT active_source_id AS activeSourceId FROM web_source_state WHERE singleton=1').get() as { activeSourceId: string | null }
    return state.activeSourceId
  }

  private toSummary(row: SourceRow): SourceSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      author: row.author,
      homepage: row.homepage,
      active: row.id === this.activeId(),
      ...(row.sources == null ? {} : { sources: JSON.parse(row.sources) }),
    }
  }

  listSources(): SourceSummary[] {
    return (getDB().prepare('SELECT id, name, description, version, author, homepage, script_path AS scriptPath, installed_at AS installedAt, sources_json AS sources FROM web_sources ORDER BY installed_at').all() as SourceRow[]).map(row => this.toSummary(row))
  }

  getSource(id: string): InstalledSource {
    const row = getDB().prepare('SELECT id, name, description, version, author, homepage, script_path AS scriptPath, installed_at AS installedAt, sources_json AS sources FROM web_sources WHERE id=?').get(id) as SourceRow | undefined
    if (row == null) throw new SourceServiceError('SOURCE_NOT_FOUND')
    const hash = /^user_api_([a-f0-9]{64})$/.exec(row.id)?.[1]
    if (hash == null) throw new SourceServiceError('SOURCE_INVALID_METADATA', 'Invalid installed source id')
    return { ...row, scriptPath: path.join(this.sourceDir, `${hash}.js`), sources: row.sources == null ? undefined : JSON.parse(row.sources) }
  }

  async installSource(script: string): Promise<SourceSummary> {
    const info = parseSourceScript(script)
    const hash = createHash('sha256').update(script).digest('hex')
    const id = `user_api_${hash}`
    if (getDB().prepare('SELECT 1 FROM web_sources WHERE id=?').get(id) != null) throw new SourceServiceError('SOURCE_DUPLICATE')
    const scriptPath = path.join(this.sourceDir, `${hash}.js`)
    const temporaryPath = path.join(this.sourceDir, `.${hash}.${randomUUID()}.tmp`)
    let renamed = false
    try {
      writeFileSync(temporaryPath, script, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporaryPath, scriptPath)
      renamed = true
      const installedAt = Date.now()
      const storedScriptPath = path.basename(scriptPath)
      getDB().prepare(`INSERT INTO web_sources (id, name, description, version, author, homepage, script_path, installed_at)
        VALUES (@id, @name, @description, @version, @author, @homepage, @scriptPath, @installedAt)`).run({ id, ...info, scriptPath: storedScriptPath, installedAt })
      return { id, ...info, active: false }
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      if (renamed && existsSync(scriptPath)) unlinkSync(scriptPath)
      if (error instanceof SourceServiceError) throw error
      throw error
    }
  }

  activateSource(id: string): SourceSummary {
    this.getSource(id)
    getDB().prepare('UPDATE web_source_state SET active_source_id=? WHERE singleton=1').run(id)
    return this.listSources().find(source => source.id === id)!
  }

  removeSource(id: string): void {
    const source = this.getSource(id)
    getDB().transaction(() => {
      getDB().prepare('DELETE FROM web_sources WHERE id=?').run(id)
      getDB().prepare('UPDATE web_source_state SET active_source_id=NULL WHERE singleton=1 AND active_source_id=?').run(id)
    })()
    if (existsSync(source.scriptPath)) unlinkSync(source.scriptPath)
  }

  setSourceCapabilities(id: string, sources: NonNullable<SourceSummary['sources']>): void {
    getDB().prepare('UPDATE web_sources SET sources_json=? WHERE id=?').run(JSON.stringify(sources), id)
  }
}
