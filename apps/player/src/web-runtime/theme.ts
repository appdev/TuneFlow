import themes from '@common/theme/index.json'
import { adaptThemeAppearance, getBaseThemeId, getThemeAppearance, isDarkAppearance } from '@common/theme/appearance'
import { buildThemeMaterial } from '@common/theme/material'

export const applyWebTheme = (settings: LX.AppSetting) => {
  const preferred = themes.find(theme => theme.id === getBaseThemeId(settings)) ?? themes[0]
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const theme = adaptThemeAppearance(preferred as LX.Theme, isDarkAppearance(getThemeAppearance(settings, preferred.isDark), dark, new Date(), settings))
  const colors = { ...theme.config.themeColors, ...buildThemeMaterial(theme.isDark), ...theme.config.extInfo }
  window.shouldUseDarkColors = dark
  window.setTheme(colors)
  return { shouldUseDarkColors: dark, theme: { id: theme.id, colors } }
}
