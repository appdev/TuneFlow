const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createHmac, createDecipheriv, randomBytes } = require('node:crypto')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/modules/winMain/accountTransferServer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject, require, Buffer, setTimeout, clearTimeout })
const { createAccountTransfer, isPrivateIPv4 } = exportsObject
const claim = (server, changes = {}) => {
  const link = new URL(server.link('127.0.0.1'))
  const key = Buffer.from(link.searchParams.get('key'), 'hex')
  const nonce = randomBytes(16).toString('hex')
  const proof = createHmac('sha256', key).update(`claim:${server.id}:${nonce}`).digest('hex')
  return { key, nonce, send: () => fetch(`http://127.0.0.1:${server.port}/qmusic-account-transfer/${server.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, proof, ...changes }),
  }) }
}
test('配对只接受规范的私有 IPv4，排除公网、域名、混淆地址', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.2.3', '192.168.1.2']) assert.equal(isPrivateIPv4(ip), true)
  for (const ip of ['127.0.0.1', '192.168.1.256', '192.168.01.1', '172.32.0.1', '1.1.1.1', 'localhost', '10.1.1.1@evil.com']) assert.equal(isPrivateIPv4(ip), false)
})
test('错误配对证明不泄露凭据；正确证明得到可验证的密文且仅可领取一次', async t => {
  const secret = 'not-a-real-credential'
  const server = await createAccountTransfer(async () => ({ cookies: { qqmusic_key: secret } }), 5000, '127.0.0.1')
  t.after(server.cancel)
  assert.equal((await claim(server, { proof: '0'.repeat(64) }).send()).status, 403)
  assert.equal(server.status(), 'waiting')
  const client = claim(server)
  const response = await client.send()
  assert.equal(response.status, 200)
  const wire = await response.text()
  assert.equal(wire.includes(secret), false)
  const envelope = JSON.parse(wire)
  const encrypted = Buffer.from(envelope.data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', client.key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from(`${server.id}:${client.nonce}`))
  decipher.setAuthTag(encrypted.subarray(-16))
  const data = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString())
  assert.equal(data.cookies.qqmusic_key, secret)
  assert.equal(data.provider, 'tx')
  assert.equal(server.status(), 'sent')
  await assert.rejects(client.send())
})
test('取消进行中的请求不发送账号；到期自动关端口', async t => {
  let resolvePayload
  const payload = new Promise(resolve => { resolvePayload = resolve })
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const server = await createAccountTransfer(async () => { entered(); return payload }, 5000, '127.0.0.1')
  t.after(server.cancel)
  const response = claim(server).send()
  await started
  server.cancel()
  resolvePayload({ cookies: { qqmusic_key: 'never-send' } })
  assert.equal((await response).status, 410)
  assert.equal(server.status(), 'cancelled')
  const expired = await createAccountTransfer(async () => ({}), 25, '127.0.0.1')
  t.after(expired.cancel)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(expired.status(), 'expired')
  await assert.rejects(claim(expired).send())
})
test('账号验证失败后关闭配对，浏览器 Origin 请求不会领取', async t => {
  const server = await createAccountTransfer(async () => { throw new Error('account_changed') }, 5000, '127.0.0.1')
  t.after(server.cancel)
  const blocked = await fetch(`http://127.0.0.1:${server.port}/qmusic-account-transfer/${server.id}`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' })
  assert.equal(blocked.status, 404)
  assert.equal((await claim(server).send()).status, 409)
  assert.equal(server.status(), 'cancelled')
})
