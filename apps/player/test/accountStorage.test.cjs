const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
function load(file, dependencies, extra = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/main/modules/winMain', file)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, require: id => dependencies[id] ?? require(id), Buffer, process, URL, console, ...extra })
  return exports
}
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-local-accounts-'))
function storage(folder, legacy = '') {
  let calls = 0
  const electron = { app: { getPath: () => folder }, safeStorage: { isEncryptionAvailable: () => true, decryptString: () => { calls++; return 'fixture-old' }, encryptString: () => { throw Error('must not write keychain') } } }
  if (legacy) fs.writeFileSync(path.join(folder, 'music_account_credentials.json'), JSON.stringify({ qqDailyApiKey: legacy, kugouSession: legacy }))
  const api = load('accountStorage.ts', { electron }, { global: { lxDataPath: folder } })
  return { api, electron, reads: () => calls }
}
test('private app files survive restart; new writes never require OS credentials; logout does not revive legacy data', () => {
  const folder = root()
  try {
    const first = storage(folder)
    assert.equal(first.api.accountStorageAvailable(), true)
    first.api.writeAccountData('qqDailyApiKey', 'fixture-new')
    assert.equal(storage(folder, 'old-encrypted').api.readAccountCredential('qqDailyApiKey'), 'fixture-new')
    assert.equal(first.reads(), 0)
    assert.throws(() => first.api.writeAccountData('qqDailyApiKey', 'x'.repeat(2 * 1024 * 1024)), /credential_storage/)
    assert.equal(first.api.readAccountCredential('qqDailyApiKey'), 'fixture-new')
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(folder, 'account-data')).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(folder, 'account-data/qqDailyApiKey.json')).mode & 0o777, 0o600)
    }
    first.api.writeAccountData('qqDailyApiKey', '')
    const restarted = storage(folder, 'old-encrypted')
    assert.equal(restarted.api.readAccountCredential('qqDailyApiKey'), '')
    assert.equal(restarted.reads(), 0)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
test('legacy decryption is read-only and performed once; unavailable legacy keys and corrupt records remain intact', () => {
  const folder = root()
  try {
    const h = storage(folder, 'old-encrypted')
    assert.equal(h.api.readAccountCredential('kugouSession'), 'fixture-old')
    assert.equal(h.api.readAccountCredential('kugouSession'), 'fixture-old')
    assert.equal(h.reads(), 1)
    assert.equal(JSON.parse(readSource(path.join(folder, 'music_account_credentials.json'))).kugouSession, 'old-encrypted')
    h.electron.safeStorage.decryptString = () => { throw Error('unavailable') }
    assert.equal(h.api.readAccountCredential('qqDailyApiKey'), '')
    assert.equal(h.api.readAccountData('qqDailyApiKey'), '')
    fs.writeFileSync(path.join(folder, 'account-data/cookies_tx.json'), '{broken')
    assert.throws(() => h.api.readAccountData('cookies_tx'), /credential_storage/)
    assert.equal(readSource(path.join(folder, 'account-data/cookies_tx.json')), '{broken')
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
test('web sessions restore app-private cookies on restart, retain HttpOnly/expiry, isolate providers and persist logout', async() => {
  const folder = root()
  try {
    const saved = storage(folder)
    const create = () => {
      const jars = new Map()
      const api = load('accountSession.ts', { './accountStorage': saved.api, electron: { app: { getPath: () => folder }, session: { fromPartition: name => {
        assert.ok(!name.startsWith('persist:'), 'fresh app must not access an OS-encrypted partition')
        if (!jars.has(name)) {
          const cookies = new EventEmitter(); cookies.items = []
          cookies.set = async data => { cookies.items.push(data) }
          jars.set(name, { cookies })
        }
        return jars.get(name)
      } } } })
      return api
    }
    const first = create(); const session = await first.readyAccountSession('tx')
    const cookie = { name: 'fixture', value: 'synthetic', domain: '.qq.com', path: '/', secure: true, httpOnly: true, hostOnly: false, sameSite: 'no_restriction', session: false, expirationDate: Date.now() / 1000 + 300 }
    session.cookies.emit('changed', {}, cookie, 'explicit', false)
    session.cookies.emit('changed', {}, { ...cookie, domain: '.evil.test' }, 'explicit', false)
    session.cookies.emit('changed', {}, { ...cookie, name: 'expired', expirationDate: 1 }, 'explicit', false)
    const restarted = create(); const restored = await restarted.readyAccountSession('tx')
    assert.equal(restored.cookies.items.length, 1)
    assert.equal(restored.cookies.items[0].httpOnly, true)
    assert.equal(restored.cookies.items[0].expirationDate, cookie.expirationDate)
    assert.equal((await restarted.readyAccountSession('wy')).cookies.items.length, 0)
    restored.cookies.emit('changed', {}, cookie, 'explicit', true)
    assert.equal((await create().readyAccountSession('tx')).cookies.items.length, 0)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})

test('legacy web cookies migrate once without clearing old data or re-opening the old partition on restart', async() => {
  const folder = root()
  try {
    const saved = storage(folder)
    const old = path.join(folder, 'Partitions/qmusic-account-qq/Cookies')
    fs.mkdirSync(path.dirname(old), { recursive: true }); fs.writeFileSync(old, 'legacy-placeholder')
    let reads = 0
    const create = () => load('accountSession.ts', { './accountStorage': saved.api, electron: { app: { getPath: () => folder }, session: { fromPartition: name => {
      if (name.startsWith('persist:')) return { cookies: { get: async() => { reads++; return [{ name: 'fixture', value: 'synthetic', domain: '.qq.com', path: '/', httpOnly: true, secure: true, session: true }] } } }
      const cookies = new EventEmitter(); cookies.items = []; cookies.set = async data => { cookies.items.push(data) }
      return { cookies }
    } } } })
    assert.equal((await create().readyAccountSession('tx')).cookies.items.length, 1)
    assert.equal((await create().readyAccountSession('tx')).cookies.items.length, 1)
    assert.equal(reads, 1)
    assert.equal(readSource(old), 'legacy-placeholder')
    assert.equal(readSource(path.join(folder, 'account-data/legacy-cookies/tx/Cookies')), 'legacy-placeholder')
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
