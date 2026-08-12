import keyBind from '../utils/keyBind'
import Event from './Event'

declare class keyEventTypes extends Event {
  on(event: string, listener: (event: TuneFlow.KeyDownEevent) => any): void
  off(event: string, listener: (event: TuneFlow.KeyDownEevent) => any): void
}

export type KeyEventTypes = keyEventTypes

export const createKeyEventHub = (): keyEventTypes => {
  return new Event()
}

window.tuneflow.isEditingHotKey = false
// let appHotKeyConfig: TuneFlow.HotKeyConfigAll = window.tuneflow.appHotKeyConfig

export const registerKeyEvent = () => {
  keyBind.bindKey((key, eventKey, type, event, keys, isEditing) => {
    // console.log(`key_${key}_${type}`)
    window.app_event.keyDown({ event, keys, key, eventKey, type })
    // console.log(event, key)
    // console.log(key, eventKey, type, event, keys)
    if (window.tuneflow.isEditingHotKey || (isEditing && type == 'down') || event?.tuneFlow_handled) return
    if (event && window.tuneflow.appHotKeyConfig.local.enable && window.tuneflow.appHotKeyConfig.local.keys[key] && (key != 'escape' || !((event.target as HTMLElement).classList.contains('ignore-esc')))) {
      // console.log(key, eventKey, type, keys, isEditing)
      event.preventDefault()
      if (type == 'up') return

      window.key_event.emit(window.tuneflow.appHotKeyConfig.local.keys[key].action)
      return
    }
    // console.log(`key_${key}_${type}`)
    window.key_event.emit(`key_${key}_${type}`, { event, keys, key, eventKey, type })
    if (key != eventKey) window.key_event.emit(`key_${eventKey}_${type}`, { event, keys, key, eventKey, type })
  })
}

export const unregisterKeyEvent = () => {
  keyBind.unbindKey()
}

export const clearDownKeys = () => {
  keyBind.clearDownKeys()
}
