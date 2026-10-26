const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(name, deps) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/core/musicAccount', `${name}.ts`)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Date, require: id => { if (!(id in deps)) throw Error(id); return deps[id] } })
  return exports
}
const identity = load('qqCredentials', {})
const valid = { qqmusic_key: 'W_X_test', musickey: 'W_X_test', qqmusic_uin: '9876', musicid: '9876', wxuin: '9876', login_type: '2' }
test('导入 Cookie 拒绝通用 QQ 凭据、头注入、身份混淆和空令牌', () => {
  const api = load('qqImportedSession', { 'react-native': { NativeModules: {} }, './qqCredentials': identity })
  assert.equal(identity.getQQCredentials(api.parseQQImportedCookies(valid)).isWeChat, true)
  for (const changes of [{ skey: 'general-qq-secret' }, { qqmusic_key: 'bad; injection=yes' }, { qqmusic_key: 'bad\r\nX: 1' }, { qqmusic_uin: '1234' }, { qqmusic_key: '' }]) assert.throws(() => api.parseQQImportedCookies({ ...valid, ...changes }))
})
test('登录导入原子保存，存储失败保留原账号；退出后不再读取导入账号', async () => {
  let saved = null
  let fail = false
  const api = load('qqImportedSession', { 'react-native': { NativeModules: { MusicCredentialModule: {
    getQQAccount: async () => saved,
    setQQAccount: async value => { if (fail) throw Error('credential_storage'); saved = value },
    clearQQAccount: async () => { saved = null },
  } } }, './qqCredentials': identity })
  await api.saveQQImportedCookies(valid)
  assert.equal((await api.getQQImportedCookies()).wxuin, '9876')
  fail = true
  await assert.rejects(api.saveQQImportedCookies({ ...valid, qqmusic_key: 'W_X_other', musickey: 'W_X_other' }), /credential_storage/)
  assert.equal((await api.getQQImportedCookies()).qqmusic_key, valid.qqmusic_key)
  await api.clearQQImportedCookies()
  assert.equal(await api.getQQImportedCookies(), null)
})
test('验证失败、过期和账号已变化时不保存；有效导入才清理账号相关缓存', async () => {
  let saved = 0
  let cleared = 0
  let current = valid
  const api = load('accountTransfer', {
    'react-native': { NativeModules: {} }, './cookies': { getProviderCookies: async () => current }, './qqCredentials': identity,
    './qqImportedSession': { saveQQImportedCookies: async () => { saved++ } }, './requests': {},
    './cache': { clearOfficialUrlCache: () => { cleared++ } }, './daily': { clearDailyCache: () => { cleared++ } },
  })
  const candidate = { cookies: valid, expiresAt: Date.now() + 10000 }
  await assert.rejects(api.saveAccountTransfer({ ...candidate, expiresAt: 1 }, valid), /transfer_expired/)
  current = { ...valid, wxuin: '1234' }
  await assert.rejects(api.saveAccountTransfer(candidate, valid), /account_changed/)
  assert.equal(saved, 0)
  current = valid
  await api.saveAccountTransfer(candidate, valid)
  assert.equal(saved, 1)
  assert.equal(cleared, 2)
})
