<template lang="pug">
dt#hot_key {{ $t('setting__hot_key') }}
dd
  h3#hot_key_local_title {{ $t('setting__hot_key_local_title') }}
  div(data-testid="settings-hotkeys-local")
    base-checkbox(id="setting_hotKeyLocal" v-model="currentHotKey.local.enable" :label="$t('setting__is_enable')")
  div(:class="$style.hotKeyContainer" :style="{ opacity: currentHotKey.local.enable ? 1 : .6 }")
    div(v-for="item in allHotKeys.local" :key="item.name" :class="$style.hotKeyItem")
      h4(:class="$style.hotKeyItemTitle") {{ $t('setting__hot_key_' + item.name) }}
      base-input(
        :class="$style.hotKeyItemInput" readonly :auto-paste="false"
        :placeholder="$t('setting__hot_key_unset_input')" :value="hotKeyConfig[item.name] && formatHotKeyName(hotKeyConfig[item.name].key)"
        @keyup.prevent @focus="handleFocus($event, item)" @blur="handleBlur($event, item)")
</template>

<script>
import { ref, onBeforeUnmount, shallowReactive, markRaw } from '@common/utils/vueTools'
import * as hotKeys from '@common/hotKey'
import { APP_EVENT_NAMES } from '@common/constants'
import { isMac } from '@common/utils'
import { useI18n } from '@renderer/plugins/i18n'

const formatHotKeyName = (value) => {
  let name = value
  if (name.includes('arrow')) {
    name = name.replace(/arrow(left|right|up|down)/, direction => ({
      arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
    })[direction])
  }
  if (name.includes('mod')) {
    name = name.replace('mod', isMac ? 'Command' : 'Ctrl')
  }
  name = name.replace(/(\+|^)[a-z]/g, letter => letter.toUpperCase())
  return name.length > 1 ? name.replace(/\+/g, ' + ') : name
}

const allHotKeys = markRaw({
  local: [
    hotKeys.HOTKEY_PLAYER.toggle_play,
    hotKeys.HOTKEY_PLAYER.prev,
    hotKeys.HOTKEY_PLAYER.next,
    hotKeys.HOTKEY_PLAYER.seekbackward,
    hotKeys.HOTKEY_PLAYER.seekforward,
    hotKeys.HOTKEY_PLAYER.music_dislike,
    hotKeys.HOTKEY_COMMON.focusSearchInput,
  ].map(({ name, action }) => ({ name, action, type: APP_EVENT_NAMES.winMainName })),
})

export default {
  name: 'SettingHotKey',
  setup() {
    const t = useI18n()
    const currentHotKey = ref(window.tuneflow.appHotKeyConfig)
    const hotKeyConfig = ref({})
    let targetInput
    let nextKey = ''
    let tip = ''

    const rebuild = () => {
      const config = {}
      for (const [key, info] of Object.entries(currentHotKey.value.local.keys)) {
        if (info.name) config[info.name] = shallowReactive({ key, info })
      }
      hotKeyConfig.value = config
    }

    const handleFocus = (event, info) => {
      window.tuneflow.isEditingHotKey = true
      nextKey = hotKeyConfig.value[info.name]?.key ?? ''
      targetInput = event.target
      targetInput.value = tip = t('setting__hot_key_tip_input')
    }

    const handleBlur = (_event, info) => {
      window.tuneflow.isEditingHotKey = false
      if (targetInput?.value == tip) {
        targetInput.value = nextKey ? formatHotKeyName(nextKey) : ''
        targetInput = null
        return
      }
      const previous = hotKeyConfig.value[info.name]?.key
      if (previous) Reflect.deleteProperty(currentHotKey.value.local.keys, previous)
      if (nextKey) {
        Reflect.deleteProperty(currentHotKey.value.local.keys, nextKey)
        currentHotKey.value.local.keys[nextKey] = info
      }
      targetInput = null
      rebuild()
    }

    const handleKeyDown = ({ event, key, type }) => {
      if (event == null || event.repeat || type === 'up' || targetInput == null) return
      event.preventDefault()
      nextKey = key === 'delete' || key === 'backspace' ? '' : key
      targetInput.value = formatHotKeyName(nextKey)
    }

    rebuild()
    window.app_event.on('keyDown', handleKeyDown)
    onBeforeUnmount(() => {
      window.app_event.off('keyDown', handleKeyDown)
      window.tuneflow.isEditingHotKey = false
    })

    return { allHotKeys, currentHotKey, hotKeyConfig, formatHotKeyName, handleFocus, handleBlur }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.hotKeyContainer {
  display: flex;
  flex-flow: row wrap;
  margin-bottom: 15px;
  transition: opacity @transition-normal;
}
.hotKeyItem {
  width: 30%;
  padding-right: 35px;
  margin-top: 15px;
  box-sizing: border-box;
}
.hotKeyItemTitle {
  .mixin-ellipsis-1();
  padding-bottom: 5px;
  color: var(--color-font-label);
  font-size: 12px;
}
.hotKeyItemInput { width: 100%; box-sizing: border-box; }

@media (max-width: 600px) {
  .hotKeyItem { width: 100%; padding-right: 0; }
}
</style>
