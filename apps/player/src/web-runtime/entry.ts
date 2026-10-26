import webProcess from './process'
import './web.css'
import { ipcRenderer } from './electron'
Object.assign(globalThis, { process: webProcess, setImmediate: (callback: (...args: any[]) => void, ...args: any[]) => setTimeout(callback, 0, ...args), clearImmediate: clearTimeout })
// Web is always attached to the page's Service, never a remembered native host.
localStorage.setItem('qmusic.docker.endpoint.v1', location.origin)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { void ipcRenderer.invoke('common_get_app_setting') })
void import('@renderer/main')
