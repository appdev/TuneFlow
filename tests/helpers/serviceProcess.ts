import type { ChildProcess } from 'node:child_process'

const waitForExit = async(service: ChildProcess, timeoutMs: number): Promise<boolean> => await new Promise(resolve => {
  if (service.exitCode != null) {
    resolve(true)
    return
  }
  let settled = false
  const finish = (exited: boolean) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    service.off('exit', onExit)
    resolve(exited)
  }
  const onExit = () => { finish(true) }
  service.once('exit', onExit)
  const timeout = setTimeout(() => { finish(false) }, timeoutMs)
})

export const stopService = async(service?: ChildProcess, timeoutMs = 5_000): Promise<void> => {
  if (service == null || service.exitCode != null) return
  const gracefulExit = waitForExit(service, timeoutMs)
  service.kill('SIGTERM')
  if (await gracefulExit) return
  const forcedExit = waitForExit(service, timeoutMs)
  service.kill('SIGKILL')
  await forcedExit
}
