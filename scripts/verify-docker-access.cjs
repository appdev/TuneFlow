const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const endpoint = 'http://127.0.0.1:3124/api/v1/access'

async function main() {
  const password = process.env.TUNEFLOW_ACCESS_PASSWORD
  if (!password) throw Error('Missing test configuration')
  const changed = createHash('sha256').update(password + ':changed').digest('hex')
  const phase = process.argv[2]
  if (!['before', 'after'].includes(phase)) throw Error('Unknown test phase')
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:3124/api/v1/health')).ok) { ready = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready)
  const request = async(path, method = 'GET', body, token) => {
    const response = await fetch(endpoint + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }
  assert.deepEqual((await request('/status')).body, { data: { passwordConfigured: true } })
  if (phase === 'before') {
    assert.equal((await request('/password', 'PUT', { password: changed })).status, 401)
    const first = await request('/login', 'POST', { password, name: 'Docker verification' })
    assert.equal(first.status, 200)
    assert.equal((await request('/password', 'PUT', { password: changed, currentPassword: password }, first.body.data.token)).status, 200)
    assert.equal((await request('/device', 'GET', undefined, first.body.data.token)).status, 200)
  } else {
    assert.equal((await request('/login', 'POST', { password, name: 'Old password verification' })).status, 401)
    assert.equal((await request('/login', 'POST', { password: changed, name: 'Restart verification' })).status, 200)
  }
  console.log(`Docker password verification (${phase} restart) passed`)
}

void main().catch(() => { console.error('Docker password verification failed'); process.exitCode = 1 })
