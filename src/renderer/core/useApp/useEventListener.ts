import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { onSettingChanged } from '@renderer/utils/ipc'
import { isShowAnimation, mergeSetting } from '@renderer/store/setting'
import { openUrl } from '@web-runtime/browser'
import { clearDownKeys } from '@renderer/event'

const handleKeyDown = ({ event, type, key }: LX.KeyDownEevent) => {
  if (key !== 'escape' || event == null || event.repeat || type === 'up' || window.lx.isEditingHotKey ||
    (event.target as HTMLElement)?.classList.contains('ignore-esc') || event.lx_handled) return
  if ((event.target as HTMLElement).tagName !== 'INPUT') return
  ;(event.target as HTMLInputElement).value = ''
  ;(event.target as HTMLInputElement).blur()
  event.lx_handled = true
}

const handleBodyClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement)?.tagName !== 'A') return
  const target = event.target as HTMLAnchorElement
  if (target.host === window.location.host) return
  event.preventDefault()
  if (/^https?:\/\//.test(target.href)) void openUrl(target.href)
}

const handleSelection = (event: LX.KeyDownEevent) => {
  event.event?.preventDefault()
}

export default () => {
  document.documentElement.classList.remove('transparent', 'disableTransparent')

  watch(isShowAnimation, enabled => {
    document.documentElement.classList.toggle('disableAnimation', !enabled)
  }, { immediate: true })

  const removeSettingListener = onSettingChanged(({ params: setting }) => {
    mergeSetting(setting)
    window.app_event.configUpdate(setting)
  })
  const handleFocus = () => { clearDownKeys() }

  window.addEventListener('focus', handleFocus)
  window.app_event.on('keyDown', handleKeyDown)
  window.key_event.on('key_mod+a_down', handleSelection)
  document.body.addEventListener('click', handleBodyClick, true)

  onBeforeUnmount(() => {
    window.removeEventListener('focus', handleFocus)
    window.app_event.off('keyDown', handleKeyDown)
    window.key_event.off('key_mod+a_down', handleSelection)
    document.body.removeEventListener('click', handleBodyClick, true)
    removeSettingListener()
  })
}
