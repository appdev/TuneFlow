import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const retiredPaths = [
  'src/main',
  'src/renderer-lyric',
  'publish',
  'src/static',
  'src/common/constants_sync.ts',
  'src/common/types/desktop_lyric.d.ts',
  'src/common/types/dislike_list_sync.d.ts',
  'src/common/types/list_sync.d.ts',
  'src/common/types/open_api.d.ts',
  'src/common/types/sync.d.ts',
  'build-config/main',
  'build-config/renderer',
  'build-config/renderer-lyric',
  'build-config/renderer-scripts',
  'build-config/lib',
  'build-config/build-after-pack.js',
  'build-config/build-before-pack.js',
  'build-config/build-pack.js',
  'build-config/dependencies-patch.js',
  'build-config/lib-update.js',
  'build-config/pack.js',
  'build-config/post-install.js',
  'build-config/runner-dev.js',
  '.github/workflows/publish-version-info.yml',
  'src/renderer/components/layout/Aside/ControlBtns.vue',
  'src/renderer/components/layout/ChangeLogModal.vue',
  'src/renderer/components/layout/SyncAuthCodeModal.vue',
  'src/renderer/components/layout/SyncModeModal.vue',
  'src/renderer/components/layout/Toolbar/ControlBtns.vue',
  'src/renderer/core/useApp/useDeeplink',
  'src/renderer/core/useApp/useHandleEnvParams.ts',
  'src/renderer/core/useApp/useOpenAPI.ts',
  'src/renderer/core/useApp/usePlayer/usePlayStatus.ts',
  'src/renderer/core/useApp/useSettingSync.ts',
  'src/renderer/core/useApp/useStatusbarLyric.ts',
  'src/renderer/core/useApp/useSync.ts',
  'src/renderer/components/common/UnsupportedCapability.vue',
  'src/renderer/components/layout/PlayDetail/autoHideMounse.js',
  'src/renderer/store/runtimeCapabilities.ts',
  'src/renderer/store/runtimeCapabilities.test.ts',
  'src/renderer/utils/compositions/useToggleDesktopLyric.js',
  'src/renderer/views/Setting/components/SettingDesktopLyric.vue',
  'src/renderer/views/Setting/components/SettingOpenAPI.vue',
  'src/renderer/views/Setting/components/SettingSync',
]

const productionRoots = [
  'src/common',
  'src/server',
  'src/renderer',
  'src/web-runtime',
  'build-config/renderer-web',
  'build-config/server',
]
const productionFiles = [
  'jsconfig.json',
  'package.json',
  'README.md',
  '.github/workflows/build-test.yml',
]
const sourceExtensions = new Set(['.cjs', '.js', '.mjs', '.ts', '.vue'])

const listProductionFiles = (path) => {
  const absolutePath = join(root, path)
  if (!existsSync(absolutePath)) return []

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) return listProductionFiles(entryPath)
    if (entry.name.endsWith('.test.mjs') || entry.name.endsWith('.test.ts')) return []
    return sourceExtensions.has(extname(entry.name)) ? [entryPath] : []
  })
}

test('package metadata has no Electron runtime or packaging roots', () => {
  assert.equal(pkg.main, undefined)
  assert.equal(pkg.scripts.postinstall, undefined)

  const retiredScripts = Object.entries(pkg.scripts)
    .filter(([name, command]) => name == 'pack' ||
      name.startsWith('pack:') ||
      name == 'publish' ||
      name.startsWith('publish:') ||
      /build:(?:main|renderer(?:-lyric|-scripts)?)/.test(name) ||
      /electron|build-config\/(?:main|renderer|renderer-lyric|renderer-scripts|pack)(?:\/|\.js)/i.test(command))
    .map(([name]) => name)
  assert.deepEqual(retiredScripts, [])

  for (const name of [
    'electron',
    'electron-builder',
    'electron-debug',
    'electron-devtools-installer',
    'electron-to-chromium',
    'electron-updater',
    'electron-log',
    'font-list',
  ]) {
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined, name)
  }
})

test('retired Electron source and build paths are absent', () => {
  const remaining = retiredPaths.filter((path) => existsSync(join(root, path)))
  assert.deepEqual(remaining, [])
})

test('Web-only source has no desktop capability classifications or runtime guards', () => {
  const forbidden = /desktop-noop|classifyCapability|runtimeCapabilities\.(?:sync|openApi|updates|windowControls|tray|desktopLyric|globalHotkeys)|window\.tuneflow\.worker\.download/
  const matches = productionRoots
    .flatMap(listProductionFiles)
    .flatMap((path) => readFileSync(join(root, path), 'utf8').split('\n').flatMap((line, index) => forbidden.test(line)
      ? [`${path}:${index + 1}: ${line.trim()}`]
      : []))

  assert.deepEqual(matches, [])
})

test('maintained CI runs the Web and Service test suite', () => {
  assert.match(readFileSync(join(root, '.github/workflows/build-test.yml'), 'utf8'), /run:\s+npm test/)
})

test('Service build and runtime target Node 24 with TagLib-Wasm packaged', () => {
  const buildConfig = readFileSync(join(root, 'build-config/server/build.mjs'), 'utf8')
  const prepareConfig = readFileSync(join(root, 'build-config/server/prepare.mjs'), 'utf8')
  const workflow = readFileSync(join(root, '.github/workflows/build-test.yml'), 'utf8')
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')

  assert.equal(pkg.engines.node, '>= 24')
  assert.equal(pkg.dependencies['taglib-wasm'], '^2.0.0')
  assert.equal([...buildConfig.matchAll(/target:\s*'node24'/g)].length, 3)
  assert.match(buildConfig, /'taglib-wasm':\s*'\^2\.0\.0'/)
  assert.match(prepareConfig, /rmSync\(path\.join\(serverRoot, 'node_modules'\), \{ recursive: true, force: true \}\)/)
  assert.match(workflow, /node-version:\s*24/)
  assert.equal([...dockerfile.matchAll(/^FROM node:24-bookworm-slim/gm)].length, 2)
})

test('Service build packages the source ZIP runtime dependency', () => {
  const buildConfig = readFileSync(join(root, 'build-config/server/build.mjs'), 'utf8')

  assert.equal(pkg.dependencies.archiver, '8.0.0')
  assert.match(buildConfig, /archiver:\s*'8\.0\.0'/)
})

test('supported Web and Service files do not import or invoke Electron', () => {
  const forbidden = /@main|@lyric|src\/main|renderer-lyric|renderer-scripts|electron-builder|electron-rebuild|build-config\/pack|from\s+['"]electron(?:[-/][^'"]*)?['"]|require\(['"]electron(?:[-/][^'"]*)?['"]\)/i
  const matches = productionRoots
    .flatMap(listProductionFiles)
    .concat(productionFiles)
    .flatMap((path) => {
      const lines = readFileSync(join(root, path), 'utf8').split('\n')
      return lines.flatMap((line, index) => forbidden.test(line)
        ? [`${relative(root, join(root, path))}:${index + 1}: ${line.trim()}`]
        : [])
    })

  assert.deepEqual(matches, [])
})
