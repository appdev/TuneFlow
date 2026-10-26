import themeActions from '@/store/theme/action'
import { updateSetting } from './common'
import { getThemeAppearance } from '@/theme/appearance'
import settingState from '@/store/setting/state'
import themeState from '@/store/theme/state'

export const setShouldUseDarkColors = (shouldUseDarkColors: boolean) => {
  themeActions.setShouldUseDarkColors(shouldUseDarkColors)
}

export const applyTheme = (theme: LX.Theme) => {
  themeActions.setTheme(theme)
}

export const setTheme = (id: string) => {
  updateSetting({ 'theme.id': id, 'theme.appearance': getThemeAppearance(settingState.setting, themeState.theme.isDark), 'theme.autoByTime': false, 'common.isAutoTheme': false })
}
