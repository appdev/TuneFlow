import { useSettingValue } from '@/store/setting/hook'
import OriginalPlayBg from './OriginalPlayBg'
import ImmersivePlayBg from './ImmersivePlayBg'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

export default ({ lyricActive }: { lyricActive: boolean }) => {
  const layout = useSettingValue('playDetail.style.layout')
  const { phone } = useAdaptiveLayout()
  const theme = useTheme()
  if (phone && layout !== 'immersive') return <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: theme['q-surface-base'] }]} />
  return layout == 'immersive' ? <ImmersivePlayBg lyricActive={lyricActive} /> : <OriginalPlayBg lyricActive={lyricActive} />
}
