import themes from '@common/theme/index.json'

const builtInThemes = themes as LX.Theme[]

export const getBuiltInThemeInfo = (): LX.ThemeInfo => ({
  themes: builtInThemes,
  userThemes: [],
  dataPath: '',
})

export const resolveBuiltInTheme = (id: string, lightId: string, darkId: string, prefersDark: boolean): LX.Theme => {
  const requestedId = id == 'auto' ? (prefersDark ? darkId : lightId) : id
  return builtInThemes.find(theme => theme.id == requestedId) ??
    builtInThemes.find(theme => theme.id == (prefersDark ? 'black' : 'green'))!
}

export const applyBuiltInTheme = ({
  id,
  lightId,
  darkId,
  prefersDark,
  setTheme,
  root,
}: {
  id: string
  lightId: string
  darkId: string
  prefersDark: boolean
  setTheme: (colors: Record<string, string>) => void
  root: Pick<HTMLElement, 'dataset'>
}): string => {
  const theme = resolveBuiltInTheme(id, lightId, darkId, prefersDark)
  setTheme({
    ...theme.config.themeColors,
    ...theme.config.extInfo,
  })
  root.dataset.themeId = theme.id
  return theme.id
}
