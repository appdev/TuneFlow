import { initSetting, showPactModal } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initPlayer from './player'
import dataInit from './dataInit'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'
import { loadServiceProfile } from '@/service/session'
import { initServiceLists } from '@/service/listStore'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      void checkUpdate()
      void initDeeplink()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await loadServiceProfile()
  global.lx.qualityList = Object.fromEntries(['kw', 'kg', 'tx', 'wy', 'mg'].map(source => [source, ['128k', '320k', 'flac', 'flac24bit']]))
  global.lx.apiInitPromise[2](true)
  bootLog('Service profile inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  initServiceLists()
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  // Shared lists come from Service; legacy peer/account sync stays inactive.

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
