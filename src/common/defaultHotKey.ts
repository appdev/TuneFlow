import { HOTKEY_PLAYER, HOTKEY_COMMON } from './hotKey'

const local: LX.HotKeyConfig = {
  enable: true,
  keys: {
    'mod+f5': {
      type: HOTKEY_PLAYER.toggle_play.type,
      name: HOTKEY_PLAYER.toggle_play.name,
      action: HOTKEY_PLAYER.toggle_play.action,
    },
    'mod+arrowleft': {
      type: HOTKEY_PLAYER.prev.type,
      name: HOTKEY_PLAYER.prev.name,
      action: HOTKEY_PLAYER.prev.action,
    },
    'mod+arrowright': {
      type: HOTKEY_PLAYER.next.type,
      name: HOTKEY_PLAYER.next.name,
      action: HOTKEY_PLAYER.next.action,
    },
    f1: {
      type: HOTKEY_COMMON.focusSearchInput.type,
      name: HOTKEY_COMMON.focusSearchInput.name,
      action: HOTKEY_COMMON.focusSearchInput.action,
    },
  },
}

const global: LX.HotKeyConfig = {
  enable: false,
  keys: {},
}

export default {
  local,
  global,
}
