import { getHotKeyConfig } from '@renderer/utils/ipc'
import { registerKeyEvent, createKeyEventHub } from './keyEvent'
// import { registerRendererEvents, unregisterRendererEvents } from './rendererEvent'
import { createAppEventHub } from './appEvent'

const ignoreUnsupportedIpc = (error: unknown) => {
  if (typeof error == 'object' && error != null && 'code' in error && error.code == 'UNSUPPORTED_IPC') return
  throw error
}

export const registerEvents = () => {
  window.lx.isEditingHotKey = false
  window.app_event = createAppEventHub()
  window.key_event = createKeyEventHub()

  const setHotkeyConfig = ({ local, global }: LX.HotKeyConfigAll) => {
    window.lx.appHotKeyConfig = {
      local,
      global,
    }
  }

  void getHotKeyConfig().then(setHotkeyConfig).catch(ignoreUnsupportedIpc)

  registerKeyEvent()
  // registerRendererEvents()
}

// export const unregisterEvents = () => {
//   unregisterKeyEvent()
//   // unregisterRendererEvents()
// }

export { clearDownKeys } from './keyEvent'

export type { AppEventTypes } from './appEvent'
export type { KeyEventTypes } from './keyEvent'

registerEvents()
