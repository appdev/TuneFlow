import { getDB } from './core/db'

export class AppDataRepository {
  constructor() {
    getDB().exec('CREATE TABLE IF NOT EXISTS web_app_data (key TEXT PRIMARY KEY, value TEXT NOT NULL);')
  }

  get<T>(key: string): T | undefined {
    const row = getDB().prepare('SELECT value FROM web_app_data WHERE key = ?').get(key) as { value: string } | undefined
    return row == null ? undefined : JSON.parse(row.value) as T
  }

  set(key: string, value: unknown): void {
    getDB().prepare('INSERT INTO web_app_data (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
  }
}
