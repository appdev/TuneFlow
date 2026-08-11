import { watch } from '@common/utils/vueTools'
import { setLanguage } from '@root/lang'
import { setUserApi } from '../apiSource'
import { proxy, themeId } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { applyBuiltInTheme } from '@renderer/store/builtInThemes'

const applyCurrentTheme = () => {
  themeId.value = applyBuiltInTheme({
    id: appSetting['theme.id'],
    lightId: appSetting['theme.lightId'],
    darkId: appSetting['theme.darkId'],
    prefersDark: window.shouldUseDarkColors,
    setTheme: window.setTheme,
    root: document.documentElement,
  })
}

export default () => {
  watch(() => appSetting['common.fontSize'], fontSize => {
    document.documentElement.style.fontSize = `${fontSize}px`
  }, { immediate: true })

  watch(() => appSetting['common.langId'], id => {
    if (!id) return
    setLanguage(id)
    window.setLang(id)
  })

  watch(() => appSetting['common.apiSource'], apiSource => {
    void setUserApi(apiSource)
  })

  watch(() => appSetting['common.font'], font => {
    document.documentElement.style.fontFamily = font
  }, { immediate: true })

  watch(() => [appSetting['theme.id'], appSetting['theme.lightId'], appSetting['theme.darkId']], applyCurrentTheme)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
    window.shouldUseDarkColors = event.matches
    if (appSetting['theme.id'] === 'auto') applyCurrentTheme()
  })

  watch(() => appSetting['network.proxy.enable'], enable => { proxy.enable = enable })
  watch(() => appSetting['network.proxy.host'], host => { proxy.host = host })
  watch(() => appSetting['network.proxy.port'], port => { proxy.port = port })
}
