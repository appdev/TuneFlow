import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { accessSync, chmodSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AccountStorageKey = 'qqDailyApiKey' | 'kugouSession' | 'cookies_tx' | 'cookies_wy' | 'cookies_kg'
const directory = () => join(app.getPath('userData'), 'account-data')
const prepare = () => {
  const folder = directory()
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(folder, 0o700)
  return folder
}
export const accountStorageAvailable = () => {
  try { accessSync(prepare(), constants.W_OK); return true } catch { return false }
}
export const readAccountData = <T>(key: AccountStorageKey): T | undefined => {
  const file = join(directory(), `${key}.json`)
  if (!existsSync(file)) return undefined
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { version: number, value: T }
    if (saved.version !== 1 || !Object.prototype.hasOwnProperty.call(saved, 'value')) throw new Error()
    return saved.value
  } catch { throw new Error('credential_storage') }
}
export const writeAccountData = (key: AccountStorageKey, value: unknown) => {
  const folder = prepare()
  const file = join(folder, `${key}.json`)
  const temporary = join(folder, `.${key}.${randomBytes(8).toString('hex')}.tmp`)
  let fd: number | undefined
  try {
    const data = JSON.stringify({ version: 1, value })
    if (Buffer.byteLength(data) > 2 * 1024 * 1024) throw new Error()
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, data, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temporary, file)
  } catch {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch {}
    throw new Error('credential_storage')
  }
}

// Compatibility reads only. New credentials never use OS encryption, and the
// old record is kept so an unavailable keychain cannot destroy existing data.
const attempted = new Set<AccountStorageKey>()
export const readAccountCredential = (key: 'qqDailyApiKey' | 'kugouSession'): string => {
  const local = readAccountData<string>(key)
  if (local !== undefined) {
    if (typeof local !== 'string') throw new Error('credential_storage')
    return local
  }
  let previous: string
  try {
    const legacy = JSON.parse(readFileSync(join(global.lxDataPath, 'music_account_credentials.json'), 'utf8')) as Record<string, unknown>
    if (typeof legacy[key] !== 'string') return ''
    previous = legacy[key]
  } catch { return '' }
  if (!previous || attempted.has(key)) return ''
  attempted.add(key)
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('legacy_unavailable')
    const value = safeStorage.decryptString(Buffer.from(previous, 'base64'))
    writeAccountData(key, value)
    return value
  } catch {
    // Cancelled legacy unlocks must not prompt on each status refresh. Keep the
    // old encrypted value untouched for rollback/recovery.
    try { writeAccountData(key, '') } catch {}
    return ''
  }
}
