const { spawn } = require('node:child_process')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const root = process.cwd()
const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'lx-service-runtime-'))
const webRoot = path.join(storageRoot, 'web')
mkdirSync(webRoot)
writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html>')

const getFreePort = async() => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (typeof address === 'string' || address == null) {
      reject(new Error('Unable to reserve a probe port'))
      return
    }
    server.close(error => {
      if (error == null) resolve(address.port)
      else reject(error)
    })
  })
})

const waitForHealth = async(port) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const healthy = await new Promise(resolve => {
      const request = http.get(`http://127.0.0.1:${port}/api/v1/health`, response => {
        response.resume()
        resolve(response.statusCode === 200)
      })
      request.on('error', () => resolve(false))
    })
    if (healthy) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Compiled Service did not start')
}

const waitForExit = (child, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(null), timeoutMs)
  child.once('error', error => {
    clearTimeout(timer)
    reject(error)
  })
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
})

const run = async() => {
  const port = await getFreePort()
  const service = spawn(process.execPath, [path.join(root, 'dist/server/index.cjs')], {
    cwd: path.join(root, 'dist/server'),
    env: { ...process.env, LX_STORAGE_ROOT: storageRoot, LX_WEB_ROOT: webRoot, LX_HOST: '127.0.0.1', LX_PORT: String(port) },
    stdio: 'pipe',
  })
  try {
    await waitForHealth(port)
    const exit = waitForExit(service, 10_000)
    service.kill('SIGTERM')
    const result = await exit
    if (result == null || result.code !== 0 || result.signal !== null) throw new Error(`Compiled Service exited unexpectedly: ${JSON.stringify(result)}`)
  } finally {
    if (service.exitCode == null && service.signalCode == null) {
      service.kill('SIGKILL')
      await waitForExit(service, 2_000)
    }
    rmSync(storageRoot, { recursive: true, force: true })
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
