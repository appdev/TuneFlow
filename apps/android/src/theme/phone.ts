// Phone-only surfaces. Preserve the chosen accent and every non-phone theme.
export const PHONE_UI = {
  gutter: 20,
  coverRadius: 14,
  controlRadius: 12,
  target: 44,
  rowHeight: 68,
} as const

export const phonePalette = {
  light: { paper: '#ffffff', surface: '#f5f5f7', ink: '#15171c', muted: '#626671', rule: '#e7e8ed', tint: '#eaeffd', accent: '#335eea', onAccent: '#ffffff', field: '#8a8d98' },
  dark: { paper: '#222222', surface: '#303030', ink: '#f4f5f7', muted: '#a5a7b0', rule: '#3d3e44', tint: '#303c5a', accent: '#bbcdff', onAccent: '#1d315f', field: '#8a8d98' },
} as const

export const adaptPhoneTheme = (theme: LX.ActiveTheme): LX.ActiveTheme => {
  // Custom themes keep their own backgrounds and surfaces as well as the accent.
  if (theme.id !== 'yesplay') return theme
  const p = phonePalette[theme.isDark ? 'dark' : 'light']
  const classic = theme.id === 'yesplay'
  return {
    ...theme,
    'c-content-background': p.paper,
    'c-app-background': p.paper,
    'c-main-background': p.paper,
    'c-font': p.ink,
    'c-font-label': p.muted,
    'q-surface-base': p.paper,
    'q-surface-raised': p.surface,
    'q-text-primary': p.ink,
    'q-text-secondary': p.muted,
    'q-outline': p.rule,
    'q-playdetail-bg': p.paper,
    ...(classic ? { 'q-accent': p.accent, 'q-accent-text': p.accent, 'q-on-accent': p.onAccent, 'q-surface-tint': p.tint } : {}),
  }
}
