const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function fixture(statuses = [true, true]) {
  const calls = []
  class ServiceError extends Error { constructor(code) { super(code); this.code = code } }
  const dependencies = {
    './accountSession': { readyAccountSession: async() => ({ cookies: { get: async() => [{ name: 'qqmusic_key', value: 'synthetic-credential' }, { name: 'p_skey', value: 'synthetic-excluded' }] } }) },
    './accountStorage': { readAccountCredential: () => 'synthetic-daily-key' },
    './kugouAccount': { readKugouSession: () => ({}) },
    './musicAccount': { getMusicAccountStatus: async() => ({ tx: statuses.shift(), accounts: { tx: { importOwner: 'fixture-owner' } } }) },
    '../../../../../../packages/service-client/src/client': { normalizeEndpoint: value => value, ServiceError },
  }
  const context = { exports: {}, AbortSignal, require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name)
    return dependencies[name]
  }, fetch: async(url, options) => { calls.push({ url, options }); return { ok: true, json: async() => ({ data: { status: 'connected' } }) } } }
  const source = fs.readFileSync(path.join(__dirname, '../src/main/modules/winMain/publishAccount.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { publish: context.exports.publishAccountToService, calls }
}

test('desktop publishes official platform credentials without a TuneFlow password or token', async() => {
  const { publish, calls } = fixture()
  assert.equal((await publish({ provider: 'tx', endpoint: 'http://fixture', revision: 3 })).status, 'connected')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers.Authorization, undefined)
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.revision, 3)
  assert.deepEqual(body.credential.cookies, { qqmusic_key: 'synthetic-credential' })
  assert.ok(!calls[0].options.body.includes('synthetic-excluded'))
})

test('publishing without a local platform login still fails before sending credentials', async() => {
  const { publish, calls } = fixture([false])
  await assert.rejects(publish({ provider: 'tx', endpoint: 'http://fixture', revision: 0 }), { code: 'PLATFORM_LOGIN_REQUIRED' })
  assert.equal(calls.length, 0)
})

test('invalid account revisions fail before sending credentials', async() => {
  const { publish, calls } = fixture()
  await assert.rejects(publish({ provider: 'tx', endpoint: 'http://fixture', revision: -1 }), { code: 'INVALID_ACCOUNT_REQUEST' })
  assert.equal(calls.length, 0)
})
