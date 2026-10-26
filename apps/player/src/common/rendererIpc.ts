import { ipcRenderer } from 'electron'
import { getRendererTransport } from './rendererTransport'

export function rendererSend(name: string): void
export function rendererSend<T>(name: string, params: T): void
export function rendererSend<T>(name: string, params?: T): void {
  if (name === 'winMain_save_data') {
    const value = params as { path: string, data: unknown }
    ipcRenderer.send(name, { ...value, path: getRendererTransport()?.dataKey(value.path) ?? value.path })
    return
  }
  ipcRenderer.send(name, params)
}

export function rendererSendSync(name: string): void
export function rendererSendSync<T>(name: string, params: T): void
export function rendererSendSync<T>(name: string, params?: T): void {
  ipcRenderer.sendSync(name, params)
}

export async function rendererInvoke(name: string): Promise<void>
export async function rendererInvoke<V>(name: string): Promise<V>
export async function rendererInvoke<T>(name: string, params: T): Promise<void>
export async function rendererInvoke<T, V>(name: string, params: T): Promise<V>
export async function rendererInvoke <T, V>(name: string, params?: T): Promise<V> {
  const transport = getRendererTransport()
  if (transport?.handles(name)) return await transport.invoke(name, params) as V
  if (name === 'winMain_get_data' && typeof params === 'string') return ipcRenderer.invoke(name, transport?.dataKey(params) ?? params)
  return ipcRenderer.invoke(name, params)
}

export function rendererOn(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  const transport = getRendererTransport()
  if (transport?.handles(name)) { transport.on(name, listener); return }
  ipcRenderer.on(name, (event, params) => {
    listener({ event, params })
  })
}

export function rendererOnce(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  const transport = getRendererTransport()
  if (transport?.handles(name)) {
    const once = (payload: any) => { transport.off(name, once); listener(payload) }
    transport.on(name, once)
    return
  }
  ipcRenderer.once(name, (event, params) => {
    listener({ event, params })
  })
}

export const rendererOff = (name: string, listener: (...args: any[]) => any) => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) { transport.off(name, listener); return }
  ipcRenderer.removeListener(name, listener)
}

export const rendererOffAll = (name: string) => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) { transport.off(name); return }
  ipcRenderer.removeAllListeners(name)
}
