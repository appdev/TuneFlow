// 启动、切换主题和主题编辑预览共用材质，避免部分入口退回固定白底。
export const buildThemeMaterial = (isDark: boolean): Record<string, string> => ({
  '--q-background-scrim': isDark ? 'rgba(10, 12, 16, .56)' : 'rgba(0, 0, 0, 0)',
  '--color-font-label': 'var(--color-650)',
  '--q-surface': `rgb(from var(--color-content-background) r g b / ${isDark ? '.82' : '.52'})`,
  '--q-surface-strong': `rgb(from var(--color-content-background) r g b / ${isDark ? '.94' : '.78'})`,
  '--q-surface-soft': `rgb(from var(--color-content-background) r g b / ${isDark ? '.64' : '.36'})`,
  '--q-border': isDark ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.64)',
  '--q-highlight': isDark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)',
  '--q-outline': 'rgb(from var(--color-font) r g b / .14)',
  '--q-menu-bg': 'rgb(from var(--color-content-background) r g b / .94)',
  '--q-menu-border': 'inset 0 0 0 1px var(--q-border)',
  '--q-shadow-soft': `0 14px 32px rgba(0,0,0,${isDark ? '.2' : '.08'})`,
  '--q-shadow-float': `0 24px 64px rgba(0,0,0,${isDark ? '.38' : '.16'})`,
})
