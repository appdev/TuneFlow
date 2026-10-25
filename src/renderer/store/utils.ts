// import { getListFromState } from './list'
// import { downloadList } from './download'


// export const getList = (listId: string | null): LX.Download.ListItem[] | LX.Music.MusicInfo[] => {
//   return listId == 'download' ? downloadList : getListFromState(listId)
// }
import { encodePath, isUrl } from '@common/utils/common'
import { buildThemeMaterial } from '@common/theme/material'
import { adaptThemeAppearance, getBaseThemeId, getThemeAppearance, isDarkAppearance } from '@common/theme/appearance'
import { appSetting } from './setting'
import { joinPath } from '@common/utils/nodejs'
import { markRaw, shallowReactive } from '@common/utils/vueTools'
import { getThemes as getTheme } from '@renderer/utils/ipc'
import { themeInfo, themeShouldUseDarkColors } from './index'

export const assertApiSupport = (source: LX.Source): boolean => {
  return source == 'local' || ['kw', 'kg', 'tx', 'wy', 'mg'].includes(source)
}

export const buildBgUrl = (originUrl: string, dataPath: string): string => {
  return isUrl(originUrl)
    ? `url(${originUrl})`
    : `url(file:///${encodePath(joinPath(dataPath, originUrl).replaceAll('\\', '/'))})`
}

export const getThemes = (callback: (themeInfo: LX.ThemeInfo) => void) => {
  if (themeInfo.themes.length) {
    callback(themeInfo)
    return
  }
  void getTheme().then(info => {
    themeInfo.themes = markRaw(info.themes)
    themeInfo.userThemes = shallowReactive(info.userThemes)
    themeInfo.dataPath = info.dataPath
    callback(themeInfo)
  }).catch(err => {
    console.error(err)
  })
}
export const buildThemeColors = (theme: LX.Theme, dataPath: string) => {
  if (theme.isCustom && theme.config.extInfo['--background-image'] != 'none') {
    theme = copyTheme(theme)
    theme.config.extInfo['--background-image'] = buildBgUrl(theme.config.extInfo['--background-image'], dataPath)
  }
  const colors: Record<string, string> = {
    ...theme.config.themeColors,
    ...buildThemeMaterial(theme.isDark),
    ...theme.config.extInfo,
  }

  return colors
}

export const copyTheme = (theme: LX.Theme): LX.Theme => {
  return {
    ...theme,
    config: {
      ...theme.config,
      extInfo: { ...theme.config.extInfo },
      themeColors: { ...theme.config.themeColors },
    },
  }
}

export const findTheme = (themeInfo: LX.ThemeInfo, id: string): LX.Theme | undefined => {
  let theme = themeInfo.themes.find(theme => theme.id == id)
  if (theme) return theme
  theme = themeInfo.userThemes.find(theme => theme.id == id)
  return theme
}

let applyThemeId = 0

export const applyTheme = (id: string, lightId: string, darkId: string, dataPath: string) => {
  const currentApplyThemeId = ++applyThemeId
  getThemes((themeInfo) => {
    if (currentApplyThemeId != applyThemeId) return
    const settings = { ...appSetting, 'theme.id': id, 'theme.lightId': lightId }
    const themeId = getBaseThemeId(settings)
    let theme = findTheme(themeInfo, themeId)
    if (!theme) {
      theme = themeInfo.themes.find(theme => theme.id == 'green') ?? themeInfo.themes[0]
    }
    if (!theme) return
    theme = adaptThemeAppearance(theme, isDarkAppearance(getThemeAppearance(settings, theme.isDark), themeShouldUseDarkColors.value, new Date(), settings))
    window.setTheme(buildThemeColors(theme, dataPath))
  })
}
