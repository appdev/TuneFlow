import { memo } from 'react'
import Feather from 'react-native-vector-icons/Feather'
import { scaleSizeW } from '@/utils/pixelRatio'
import { Icon } from './Icon'

// Navigation uses one outline family; other app icons keep their existing styles.
const names: Record<string, string> = {
  'search-2': 'home',
  home: 'home',
  album: 'music',
  leaderboard: 'bar-chart-2',
  love: 'heart',
  'download-2': 'download',
  setting: 'settings',
}

export default memo(({ name, size, color }: { name: string, size: number, color: string }) => {
  const glyph = names[name]
  return glyph
    ? <Feather accessible={false} name={glyph} size={scaleSizeW(size)} color={color} style={{ includeFontPadding: false, textAlignVertical: 'center' }} />
    : <Icon accessible={false} name={name} size={size} color={color} />
})
