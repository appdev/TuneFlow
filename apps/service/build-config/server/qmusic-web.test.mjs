import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('shared Web build excludes stale legacy assets and preserves the previous output', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-vue-web-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const client = path.join(root, 'player')
  const service = path.join(root, 'service')
  const output = path.join(service, 'dist/web-qmusic')
  mkdirSync(client)
  mkdirSync(path.join(service, 'build-config/server'), { recursive: true })
  mkdirSync(path.join(output, 'V2'), { recursive: true })
  writeFileSync(path.join(output, 'V2/index.html'), 'previous legacy output')
  writeFileSync(path.join(client, 'package.json'), JSON.stringify({
    name: 'q-music', version: '1.0.0', scripts: { 'build:web': 'node build.cjs' },
  }))
  writeFileSync(path.join(client, 'build.cjs'), "require('node:fs').writeFileSync(require('node:path').join(process.env.Q_WEB_OUTPUT, 'index.html'), '<title>Shared Vue Web</title>')")
  const script = path.join(service, 'build-config/server/build-qmusic-web.mjs')
  writeFileSync(script, readFileSync(new URL('./build-qmusic-web.mjs', import.meta.url)))
  execFileSync(process.execPath, [script, client], { stdio: 'pipe' })
  assert.match(readFileSync(path.join(output, 'index.html'), 'utf8'), /Shared Vue Web/)
  assert.equal(existsSync(path.join(output, 'V2')), false)
  assert.equal(existsSync(path.join(output, 'main.dart.js')), false)
  const metadata = JSON.parse(readFileSync(path.join(output, 'qmusic-web.json'), 'utf8'))
  assert.equal(metadata.version, '1.0.0')
  assert.equal(metadata.api, '/api/v1/')
  assert.equal(metadata.legacy, undefined)
  const backup = readdirSync(path.join(service, 'dist')).find(name => name.startsWith('web-qmusic-backup-'))
  assert.ok(backup)
  assert.equal(readFileSync(path.join(service, 'dist', backup, 'V2/index.html'), 'utf8'), 'previous legacy output')
})
