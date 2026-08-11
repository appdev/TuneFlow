import Database from 'better-sqlite3'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'path'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'
import { resetListCache } from '../lists'

let db: Database.Database | undefined
let exitHookInstalled = false


const initTables = (db: Database.Database) => {
  db.exec(`
    ${Array.from(tables.values()).join('\n')}
    INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
  `)
}

const getDatabaseConstructor = (): typeof Database => {
  const serviceModules = process.env.LX_SERVICE_NODE_MODULES
  if (serviceModules == null) return Database
  const createServiceRequire: typeof createRequire = Reflect.get({ createRequire }, 'createRequire')
  const serviceRequire = createServiceRequire(path.join(path.resolve(serviceModules), '..', 'package.json'))
  return serviceRequire('better-sqlite3') as typeof Database
}


// 打开、初始化数据库
export const init = (lxDataPath: string): boolean | null => {
  close()
  const databasePath = path.join(lxDataPath, 'lx.data.db')
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  const bindingOptions = existsSync(nativeBinding) ? { nativeBinding } : {}
  const DatabaseConstructor = getDatabaseConstructor()
  let dbFileExists = existsSync(databasePath)

  if (dbFileExists) {
    db = new DatabaseConstructor(databasePath, {
      fileMustExist: true,
      ...bindingOptions,
      // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
    })
  } else {
    db = new DatabaseConstructor(databasePath, {
      ...bindingOptions,
      // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
    })
    initTables(db)
    dbFileExists = false
  }
  db.pragma('journal_mode = WAL')

  if (dbFileExists) migrateData(db)

  // https://www.sqlite.org/pragma.html#pragma_optimize
  if (dbFileExists) db.exec('PRAGMA optimize;')
  if (!verifyDB(db)) {
    close()
    return null
  }

  // https://www.sqlite.org/lang_vacuum.html
  // db.exec('VACUUM "main"')

  if (!exitHookInstalled) {
    process.once('exit', close)
    exitHookInstalled = true
  }
  console.log('db inited')
  // require('./test')
  return dbFileExists
}

// 获取数据库实例
export const getDB = (): Database.Database => {
  if (db == null) throw new Error('Database has not been initialized')
  return db
}

/** Clears the open database and every repository cache before a new root is used. */
export const close = (): void => {
  if (db?.open) db.close()
  db = undefined
  resetListCache()
}
