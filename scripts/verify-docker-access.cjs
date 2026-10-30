const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const endpoint = 'http://127.0.0.1:3124'
async function main() {
  const phase = process.argv[2]
  if (!['before', 'after'].includes(phase)) throw Error('Unknown test phase')
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(endpoint + '/api/v1/health')).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready)
  const response = await fetch(endpoint + '/api/v1/accounts/status', { headers: { Origin: 'https://relay.example.com' } })
  assert.equal(response.status, 200)
  const { data } = await response.json()
  assert.ok(data.serverId)
  assert.equal(data.tx, false)
  assert.equal(data.wy, false)
  assert.equal(data.kg, false)
  assert.equal((await fetch(endpoint + '/api/v1/access/status')).status, 404)
  const marker = '/config/account-verification-server-id'
  if (phase === 'before') writeFileSync(marker, data.serverId)
  else assert.equal(readFileSync(marker, 'utf8'), data.serverId)
  console.log(`Docker password-free account verification (${phase} restart) passed`)
}
void main().catch(() => { console.error('Docker account verification failed'); process.exitCode = 1 })
