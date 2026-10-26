const { createRequire } = require('node:module')
const path = require('node:path')

const requireService = createRequire(path.join(process.cwd(), 'package.json'))
const Database = requireService('better-sqlite3')

const database = new Database(':memory:')
database.exec('CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe (value) VALUES (\'ok\');')
if (database.prepare('SELECT value FROM probe').get().value !== 'ok') throw new Error('Node Service SQLite probe failed')
database.close()
