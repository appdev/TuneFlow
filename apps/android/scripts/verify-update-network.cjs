const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, dependencies, extra = {}) {
  const context = { exports: {}, console, setTimeout, clearTimeout, ...extra,
    require: id => { if (!(id in dependencies)) throw new Error(id); return dependencies[id] },
  }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '..', file)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, context)
  return context.exports
}
const sources = load('src/utils/updateSources.ts', { './updateMirror.json': { baseUrl: '' } })
const digest = 'a'.repeat(64)
const name = 'Q-music-android-v0.4.10-arm64-v8a.apk'
test('整合版只使用自有更新仓库，并识别已公开的预览通道', async() => {
  assert.equal(sources.releaseBase, 'https://github.com/appdev/TuneFlow/releases/download/')
  const result = await sources.getUpdateVersion(async url => {
    assert.ok(url.includes('appdev/TuneFlow'))
    if (url.includes('api.github')) return [
      { tag_name: 'client-v0.4.25', prerelease: true, body: 'unrelated prerelease', assets: [{ name }] },
      { tag_name: 'client-v0.4.24', prerelease: true, body: '<!-- qmusic-service-preview -->', assets: [{ name }] },
      { tag_name: 'client-v0.4.26', draft: true, body: '<!-- qmusic-service-preview -->', assets: [{ name }] },
    ]
    throw Error('offline')
  }, 'android')
  assert.equal(result.version, '0.4.24')
})
function setup(outcomes) {
  let attempts = 0
  let installed = 0
  let present = false
  let actualHash = ''
  const urls = []
  const timers = new Map()
  let timerId = 0
  let rejectStalled
  const api = load('src/utils/version.js', {
    '@/utils/request': { httpGet: (url, options, callback) => callback(null, { statusCode: 200 }, `${digest}  ${name}\n`) },
    './updateSources': sources,
    '@/utils/nativeModules/utils': { getSupportedAbis: async() => ['arm64-v8a'], installApk: async() => { installed++ } },
    '@/config/constant': { APP_PROVIDER_NAME: 'preview' },
    '@/utils/fs': {
      temporaryDirectoryPath: '/cache', existsFile: async() => present,
      hash: async() => actualHash, unlink: async() => { present = false }, stopDownload() { rejectStalled?.(Error('timeout')) },
      downloadFile(url, file, options) {
        urls.push(url)
        const outcome = outcomes[attempts++] ?? 'ok'
        present = true
        options.begin({ contentLength: 100, statusCode: 200 })
        actualHash = outcome === 'corrupt' ? 'bad' : digest
        return { jobId: attempts, promise: outcome === 'stall' ? new Promise((resolve, reject) => { rejectStalled = reject }) : outcome === 'offline' ? Promise.reject(Error('offline')) : Promise.resolve({ statusCode: outcome === 'html' ? 503 : 200, bytesWritten: outcome === 'partial' ? 50 : 100 }) }
      },
    },
  }, { setTimeout: callback => { timers.set(++timerId, callback); return timerId }, clearTimeout: id => timers.delete(id) })
  return { api, urls, attempts: () => attempts, installed: () => installed, tick: () => { for (const callback of [...timers.values()]) callback() }, timers }
}
test('安卓 GitHub 断网时从镜像取得版本，过滤 PC 独立版本', async() => {
  const result = await sources.getUpdateVersion(async url => {
    if (url.includes('api.github')) return [
      { tag_name: 'client-v0.5.0', assets: [{ name: 'latest.yml' }] },
      { tag_name: 'client-v0.4.10', assets: [{ name }] },
    ]
    throw Error('offline')
  }, 'android')
  assert.equal(result.version, '0.4.10')
  assert.equal((await sources.getUpdateVersion(async url => {
    if (url.startsWith('https://gh-proxy.com/')) return { version: '0.4.10' }
    throw Error('blocked')
  }, 'android')).version, '0.4.10')
})
test('安卓断网、错误网页、截断、哈希错误均不进入安装，自动切线', async() => {
  for (const failure of ['offline', 'html', 'partial', 'corrupt']) {
    const run = setup([failure, 'ok'])
    await run.api.downloadNewVersion('0.4.10')
    assert.equal(run.attempts(), 2)
    assert.notEqual(run.urls[0], run.urls[1])
    assert.equal(run.installed(), 0)
    await run.api.updateApp()
    assert.equal(run.installed(), 1)
  }
})
test('安卓重复点击合并任务，已校验缓存复用，不重复下载', async() => {
  const run = setup(['ok'])
  const first = run.api.downloadNewVersion('0.4.10')
  const second = run.api.downloadNewVersion('0.4.10')
  assert.equal(first, second)
  await first
  await run.api.downloadNewVersion('0.4.10')
  assert.equal(run.attempts(), 1)
})
test('全部线路失败可再次重试，失败文件不能安装', async() => {
  const run = setup(['corrupt', 'corrupt', 'corrupt', 'corrupt', 'ok'])
  await assert.rejects(run.api.downloadNewVersion('0.4.10'))
  await assert.rejects(run.api.updateApp())
  await run.api.downloadNewVersion('0.4.10')
  assert.equal(run.attempts(), 5)
})
test('安卓下载无进展时停止旧任务并自动切线，完成后清理看门狗', async() => {
  const run = setup(['stall', 'ok'])
  const pending = run.api.downloadNewVersion('0.4.10')
  for (let i = 0; i < 40; i++) await Promise.resolve()
  assert.equal(run.attempts(), 1)
  run.tick()
  await pending
  assert.equal(run.attempts(), 2)
  assert.equal(run.timers.size, 0)
})
