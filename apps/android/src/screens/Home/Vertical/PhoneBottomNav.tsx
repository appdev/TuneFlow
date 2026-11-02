import { Keyboard, StyleSheet, View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { useI18n } from '@/lang'

const items = [
  { id: 'nav_search', icon: 'search-2', label: 'mobile_discover' },
  { id: 'nav_songlist', icon: 'album', label: 'nav_songlist' },
  { id: 'nav_top', icon: 'leaderboard', label: 'nav_top' },
  { id: 'nav_love', icon: 'love', label: 'mobile_library' },
] as const

export default () => {
  const theme = useTheme()
  const activeId = useNavActiveId()
  const t = useI18n()
  return <View style={[styles.container, { backgroundColor: theme['q-surface-base'] }]}>
    {items.map(item => {
      const active = activeId === item.id || (item.id === 'nav_love' && (activeId === 'download' || activeId === 'nav_setting'))
      const color = theme[active ? 'q-accent-text' : 'q-text-secondary']
      return <Button key={item.id} accessibilityRole="tab" accessibilityLabel={t(item.label)} accessibilityState={{ selected: active }} style={styles.item} onPress={() => { Keyboard.dismiss(); setNavActiveId(item.id) }}>
        <Icon accessible={false} name={item.icon} rawSize={21} color={color} />
        <Text size={11} color={color} style={{ fontWeight: active ? '600' : '400' }}>{t(item.label)}</Text>
      </Button>
    })}
  </View>
}
const styles = StyleSheet.create({
  container: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 4 },
  item: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 4 },
})
