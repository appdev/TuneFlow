import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

const getFreePort = async(): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (typeof address === 'string' || address == null) {
      reject(new Error('Unable to reserve a test port'))
      return
    }
    server.close(error => {
      if (error == null) resolve(address.port)
      else reject(error)
    })
  })
})

const waitForHealth = async(port: number): Promise<void> => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).status === 200) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Service did not start before the signal test deadline')
}

const waitForShutdown = async(port: number): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/health`)
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('prepared Service continued serving after shutdown')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Service process shutdown', () => {
  it('starts and gracefully stops the prepared Service command', async() => {
    const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-service-signal-'))
    const webRoot = path.join(storageRoot, 'web')
    roots.push(storageRoot)
    mkdirSync(webRoot)
    writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html>')
    const port = await getFreePort()
    const child = spawn('npm', ['run', 'start:server'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TUNEFLOW_STORAGE_ROOT: storageRoot,
        TUNEFLOW_WEB_ROOT: webRoot,
        TUNEFLOW_HOST: '127.0.0.1',
        TUNEFLOW_PORT: String(port),
        TUNEFLOW_SKIP_ELECTRON_REBUILD: '1',
      },
      stdio: 'pipe',
      detached: process.platform !== 'win32',
    })
    try {
      await waitForHealth(port)
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid!, 'SIGTERM')
      const result = await Promise.race([
        new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', (code, signal) => {
            resolve({ code, signal })
          })
        }),
        new Promise<never>((_resolve, reject) => setTimeout(() => {
          reject(new Error('prepared Service did not stop after SIGTERM'))
        }, 10_000)),
      ])
      expect(result).toEqual({ code: null, signal: 'SIGTERM' })
      await waitForShutdown(port)
    } finally {
      if (child.exitCode == null && child.signalCode == null) {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid!, 'SIGKILL')
        await new Promise<void>(resolve => {
          child.once('exit', () => {
            resolve()
          })
          setTimeout(resolve, 2_000)
        })
      }
    }
  }, 30_000)
})
