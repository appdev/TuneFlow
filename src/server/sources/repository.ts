import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_SOURCE_SCRIPT_BYTES } from '../../common/constants'
import { getDB } from '../db/core/db'
import { parseSourceScript } from './parser'
import { SourceServiceError, type InstalledSource, type SourceSummary } from './types'

interface SourceRow extends Omit<InstalledSource, 'sources'> {
  sources: string | null
  priority: number | null
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
      CREATE TABLE IF NOT EXISTS web_source_selection (
        source_id TEXT PRIMARY KEY REFERENCES web_sources(id) ON DELETE CASCADE,
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
      );
      INSERT INTO web_source_selection (source_id, position)
      SELECT active_source_id, 0
      FROM web_source_state
      WHERE singleton = 1
        AND active_source_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM web_sources WHERE id = active_source_id)
        AND NOT EXISTS (SELECT 1 FROM web_source_selection);
    `)
  }

  private toSummary(row: SourceRow): SourceSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      author: row.author,
      homepage: row.homepage,
      active: row.priority === 0,
      enabled: row.priority != null,
      priority: row.priority,
      ...(row.sources == null ? {} : { sources: JSON.parse(row.sources) }),
    }
  }

  listSources(): SourceSummary[] {
    return (getDB().prepare(`
      SELECT s.id, s.name, s.description, s.version, s.author, s.homepage,
        s.script_path AS scriptPath, s.installed_at AS installedAt,
        s.sources_json AS sources, selection.position AS priority
      FROM web_sources s
      LEFT JOIN web_source_selection selection ON selection.source_id = s.id
      ORDER BY s.installed_at
    `).all() as SourceRow[]).map(row => this.toSummary(row))
  }

  getSource(id: string): InstalledSource {
    const row = getDB().prepare('SELECT id, name, description, version, author, homepage, script_path AS scriptPath, installed_at AS installedAt, sources_json AS sources FROM web_sources WHERE id=?').get(id) as SourceRow | undefined
    if (row == null) throw new SourceServiceError('SOURCE_NOT_FOUND')
    const hash = /^user_api_([a-f0-9]{64})$/.exec(row.id)?.[1]
    if (hash == null) throw new SourceServiceError('SOURCE_INVALID_METADATA', 'Invalid installed source id')
    return { ...row, scriptPath: path.join(this.sourceDir, `${hash}.js`), sources: row.sources == null ? undefined : JSON.parse(row.sources) }
  }

  async installSource(script: string): Promise<SourceSummary> {
    if (Buffer.byteLength(script, 'utf8') > MAX_SOURCE_SCRIPT_BYTES) throw new SourceServiceError('SOURCE_SCRIPT_TOO_LARGE', 'Source script exceeds 1 MiB')
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
      return { id, ...info, active: false, enabled: false, priority: null }
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      if (renamed && existsSync(scriptPath)) unlinkSync(scriptPath)
      if (error instanceof SourceServiceError) throw error
      throw error
    }
  }

  private replaceSelectionRows(ids: readonly string[]): void {
    const database = getDB()
    database.prepare('DELETE FROM web_source_selection').run()
    const insert = database.prepare('INSERT INTO web_source_selection (source_id, position) VALUES (?, ?)')
    ids.forEach((id, position) => insert.run(id, position))
    database.prepare('UPDATE web_source_state SET active_source_id=? WHERE singleton=1').run(ids[0] ?? null)
  }

  setEnabledSourceIds(ids: readonly string[]): SourceSummary[] {
    if (new Set(ids).size !== ids.length) throw new SourceServiceError('SOURCE_DUPLICATE')
    for (const id of ids) this.getSource(id)
    getDB().transaction(() => { this.replaceSelectionRows(ids) })()
    return this.listSources()
  }

  promoteSource(id: string): SourceSummary {
    this.getSource(id)
    const current = (getDB().prepare('SELECT source_id AS sourceId FROM web_source_selection ORDER BY position').all() as Array<{ sourceId: string }>).map(row => row.sourceId)
    const promoted = [id, ...current.filter(sourceId => sourceId !== id)]
    getDB().transaction(() => { this.replaceSelectionRows(promoted) })()
    return this.listSources().find(source => source.id === id)!
  }

  activateSource(id: string): SourceSummary {
    return this.promoteSource(id)
  }

  removeSource(id: string): void {
    const source = this.getSource(id)
    getDB().transaction(() => {
      getDB().prepare('DELETE FROM web_sources WHERE id=?').run(id)
      const remaining = (getDB().prepare('SELECT source_id AS sourceId FROM web_source_selection ORDER BY position').all() as Array<{ sourceId: string }>).map(row => row.sourceId)
      this.replaceSelectionRows(remaining)
    })()
    if (existsSync(source.scriptPath)) unlinkSync(source.scriptPath)
  }

  setSourceCapabilities(id: string, sources: NonNullable<SourceSummary['sources']>): void {
    getDB().prepare('UPDATE web_sources SET sources_json=? WHERE id=?').run(JSON.stringify(sources), id)
  }
}
