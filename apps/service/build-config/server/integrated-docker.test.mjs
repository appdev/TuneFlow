import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildIntegratedDocker } from './build-integrated-docker.mjs'
import { installIntegratedWeb, validateIntegratedWeb } from './install-integrated-web.mjs'

const fixture = (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-integrated-docker-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

const createWeb = (root) => {
  const web = path.join(root, 'dist/web-integrated')
  mkdirSync(path.join(web, 'V2'), { recursive: true })
  writeFileSync(path.join(web, 'index.html'), '<base href="/"><title>Flutter</title>')
  writeFileSync(path.join(web, 'main.dart.js'), 'flutterMain()')
  writeFileSync(path.join(web, 'flutter_bootstrap.js'), 'bootstrap()')
  writeFileSync(path.join(web, 'V2/index.html'), '<script src="/V2/renderer.js"></script>')
  writeFileSync(path.join(web, 'V2/renderer.js'), 'legacy()')
  return web
}

test('installs both frontends without copying host Service binaries', (t) => {
  const root = fixture(t)
  createWeb(root)
  mkdirSync(path.join(root, 'dist/server'), { recursive: true })
  writeFileSync(path.join(root, 'dist/server/native.node'), 'host binary')
  installIntegratedWeb(root)
  assert.match(readFileSync(path.join(root, 'dist/web/index.html'), 'utf8'), /Flutter/)
  assert.match(readFileSync(path.join(root, 'dist/web/V2/index.html'), 'utf8'), /\/V2\/renderer.js/)
  assert.equal(existsSync(path.join(root, 'dist/web/server')), false)
})

test('refuses incomplete bundles, wrong base href, and symbolic links', (t) => {
  const root = fixture(t)
  const web = createWeb(root)
  rmSync(path.join(web, 'V2/renderer.js'))
  assert.throws(() => validateIntegratedWeb(web), /Missing integrated Web asset/)
  writeFileSync(path.join(web, 'V2/renderer.js'), 'legacy()')
  writeFileSync(path.join(web, 'index.html'), '<base href="/other/">')
  assert.throws(() => validateIntegratedWeb(web), /--base-href/)
  writeFileSync(path.join(web, 'index.html'), '<base href="/">')
  symlinkSync('index.html', path.join(web, 'alias.html'))
  assert.throws(() => validateIntegratedWeb(web), /symbolic links/)
})

test('refuses to overwrite an existing legacy Web directory', (t) => {
  const root = fixture(t)
  createWeb(root)
  mkdirSync(path.join(root, 'dist/web'))
  writeFileSync(path.join(root, 'dist/web/index.html'), 'keep me')
  assert.throws(() => installIntegratedWeb(root), /Refusing to overwrite/)
  assert.equal(readFileSync(path.join(root, 'dist/web/index.html'), 'utf8'), 'keep me')
})

test('build checks Docker, compiles current Flutter, then builds only the existing service', (t) => {
  const root = fixture(t)
  const flutter = path.join(root, 'flutter client')
  mkdirSync(flutter)
  writeFileSync(path.join(flutter, 'pubspec.yaml'), 'name: fixture')
  const calls = []
  buildIntegratedDocker([flutter], {
    serviceRoot: root,
    run: (command, args, options) => {
      calls.push([command, args])
      assert.equal(options.cwd, root)
      if (command === 'npm') createWeb(root)
    },
  })
  assert.deepEqual(calls, [
    ['docker', ['info', '--format', '{{.ServerVersion}}']],
    ['docker', ['compose', 'version']],
    ['npm', ['run', 'build:web:integrated', '--', flutter]],
    ['docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.integrated.yaml', 'build', 'tuneflow-web']],
  ])
})

test('reuse mode validates assets and never invokes Flutter or replaces containers', (t) => {
  const root = fixture(t)
  const calls = []
  const run = (command, args) => calls.push([command, ...args])
  assert.throws(() => buildIntegratedDocker(['--skip-web-build'], { serviceRoot: root, run }), /Missing integrated Web asset/)
  assert.deepEqual(calls, [])
  createWeb(root)
  buildIntegratedDocker(['--skip-web-build'], { serviceRoot: root, run })
  assert.equal(calls.length, 3)
  assert(calls.every(call => call[0] === 'docker' && !call.includes('up') && !call.includes('down')))
})

test('a missing Docker daemon fails before compilation', (t) => {
  const root = fixture(t)
  const flutter = path.join(root, 'flutter')
  mkdirSync(flutter)
  writeFileSync(path.join(flutter, 'pubspec.yaml'), 'name: fixture')
  let calls = 0
  assert.throws(() => buildIntegratedDocker([flutter], {
    serviceRoot: root,
    run: () => { calls++; throw new Error('Docker unavailable') },
  }), /Docker unavailable/)
  assert.equal(calls, 1)
})

test('Docker integration keeps one Node runtime and the existing Compose service', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const compose = readFileSync(path.join(root, 'compose.integrated.yaml'), 'utf8')
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8')
  assert.match(dockerfile, /ARG TUNEFLOW_WEB_VARIANT=legacy/)
  assert.match(dockerfile, /install-integrated-web\.mjs && npm run prepare:service/)
  assert.match(dockerfile, /COPY --from=build --chown=node:node \/app\/dist\/web \.\/dist\/web/)
  assert.match(dockerfile, /CMD \["node", "dist\/server\/index.cjs"\]/)
  assert.match(compose, /tuneflow-web:[\s\S]*TUNEFLOW_WEB_VARIANT: integrated/)
  assert.doesNotMatch(compose, /volumes:|ports:|command:|user:/)
  assert.match(ignore, /dist\n!dist\/\ndist\/\*\n!dist\/web-integrated\/\n!dist\/web-integrated\/\*\*/)
})
