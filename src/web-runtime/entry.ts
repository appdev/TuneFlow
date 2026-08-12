import { getWebRuntime } from './rendererIpc'
import type { WebRuntime } from './types'
import { installWebSchedulingGlobals } from './webGlobals'
import { installWebContextMenuGuard } from './contextMenu'

interface WebProcess {
  arch: string
  platform: string
  versions: Record<string, string>
  env: Record<string, string | undefined>
  on: (event: string, listener: (...args: any[]) => void) => void
}

const runtime = globalThis as typeof globalThis & {
  tuneFlowWebCapabilities?: WebRuntime['capabilities']
  tuneFlowWebRuntime?: WebRuntime
  process?: WebProcess
}

installWebSchedulingGlobals(runtime)
installWebContextMenuGuard(document)
runtime.process ??= {
  arch: 'web',
  platform: 'web',
  versions: {},
  env: {},
  on: () => {},
}
runtime.process.arch ??= 'web'
runtime.process.platform ??= 'web'
runtime.process.versions ??= {}
runtime.process.versions.app ??= 'web'
runtime.process.env ??= {}
runtime.process.env.NODE_ENV ??= 'production'
runtime.process.on ??= () => {}
runtime.tuneFlowWebRuntime = getWebRuntime()
runtime.tuneFlowWebCapabilities = runtime.tuneFlowWebRuntime.capabilities

void import('@renderer/main')
