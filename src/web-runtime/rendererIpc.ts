import { ipcRenderer } from './electron'
import { getRendererTransport } from '@common/rendererTransport'
const wrappers = new Map<string, Map<(...args: any[]) => void, (...args: any[]) => void>>()
export const rendererInvoke = async<T, V = T>(name: string, params?: T): Promise<V> => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) return await transport.invoke(name, params) as V
  return await ipcRenderer.invoke(name, name === 'winMain_get_data' && typeof params === 'string' ? transport?.dataKey(params) ?? params : params) as V
}
export const rendererSend = <T>(name: string, params?: T) => {
  if (name === 'winMain_save_data') {
    const value = params as { path: string, data: unknown }
    ipcRenderer.send(name, { ...value, path: getRendererTransport()?.dataKey(value.path) ?? value.path })
  } else ipcRenderer.send(name, params)
}
export const rendererSendSync = (name: string) => ipcRenderer.sendSync(name)
export const rendererOn = <T = unknown>(name: string, listener: (payload: { event: unknown, params: T }) => void) => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) { transport.on(name, listener); return }
  if (!wrappers.has(name)) wrappers.set(name, new Map())
  if (wrappers.get(name)!.has(listener)) return
  const wrapped = (_event: unknown, params: T) => { listener({ event: null, params }) }
  wrappers.get(name)!.set(listener, wrapped); ipcRenderer.on(name, wrapped)
}
export const rendererOff = (name: string, listener: (...args: any[]) => void) => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) { transport.off(name, listener); return }
  const wrapped = wrappers.get(name)?.get(listener)
  if (wrapped) ipcRenderer.removeListener(name, wrapped)
  wrappers.get(name)?.delete(listener)
}
export const rendererOnce = <T = unknown>(name: string, listener: (payload: { event: unknown, params: T }) => void) => {
  const once = (payload: { event: unknown, params: T }) => { rendererOff(name, once); listener(payload) }
  rendererOn(name, once)
}
export const rendererOffAll = (name: string) => {
  const transport = getRendererTransport()
  if (transport?.handles(name)) transport.off(name)
  else { ipcRenderer.removeAllListeners(name); wrappers.delete(name) }
}
