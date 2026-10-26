import { buildActiveThemeColors } from './themes'
import themes from './themes/themes'

export type PlayerLayout = LX.AppSetting['playDetail.style.layout']

// 播放详情使用局部主题，切换风格不改变首页、用户配色或自动深浅色设置。
export const getPlayerTheme = (base: LX.ActiveTheme, layout: PlayerLayout): LX.ActiveTheme => {
  if (layout != 'immersive') return base
  const dark = buildActiveThemeColors(themes.find(theme => theme.id == 'black')!)
  return {
    ...dark,
    'c-content-background': '#1b1e22',
    'c-font': '#f7f8fa',
    'c-font-label': '#cbd0d8',
    'q-text-primary': '#f7f8fa',
    'q-text-secondary': '#cbd0d8',
    'q-accent': '#e9ecf1',
    'q-accent-text': '#ffffff',
    'q-on-accent': '#1b1e22',
    'q-surface-base': 'rgba(27,30,34,0.88)',
    'q-surface-raised': 'rgba(35,39,45,0.90)',
    'q-surface-tint': 'rgba(255,255,255,0.12)',
    'q-outline': 'rgba(255,255,255,0.14)',
    'q-playdetail-bg': '#1b1e22',
  }
}
