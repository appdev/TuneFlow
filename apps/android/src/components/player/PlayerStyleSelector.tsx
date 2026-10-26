import { StyleSheet, View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const layouts = ['classic', 'immersive'] as const

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const layout = useSettingValue('playDetail.style.layout')
  return <View style={styles.container}>
    <Text size={14} style={styles.heading}>{t('player_appearance_title')}</Text>
    <View style={styles.options}>
      {layouts.map(value => {
        const selected = value == layout
        const classic = value == 'classic'
        return <Button key={value} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={t(`player_appearance_${value}`)}
          onPress={() => { updateSetting({ 'playDetail.style.layout': value }) }}
          style={[styles.option, { backgroundColor: theme['q-surface-raised'], borderColor: selected ? theme['q-accent-text'] : theme['q-outline'] }]}>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.preview, { backgroundColor: classic ? '#eef0ed' : '#292b37' }]}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={[styles.artwork, { backgroundColor: classic ? '#92b5a3' : '#b77c8c' }, !classic && { width: 34, height: 34, borderRadius: 4 }]} />
              {!classic && <View style={{ flexDirection: 'row', gap: 7 }}>{[0, 1, 2].map(index => <View key={index} style={{ width: index == 1 ? 5 : 3, height: 4, backgroundColor: '#fff', borderRadius: 1 }} />)}</View>}
            </View>
            <View style={styles.lines}>{[0, 1, 2].map(index => <View key={index} style={{ height: index == 1 ? (classic ? 5 : 8) : 3, marginVertical: 4, width: index == 2 ? '64%' : '88%', borderRadius: 3, backgroundColor: classic ? (index == 1 ? '#424846' : '#9ba29d') : (index == 1 ? '#fff' : '#737683') }} />)}</View>
          </View>
          <View style={styles.labelRow}>
            <Text size={14} style={{ flex: 1, fontWeight: '600' }}>{t(`player_appearance_${value}`)}</Text>
            <View style={[styles.radio, { borderColor: selected ? theme['q-accent-text'] : theme['q-outline'] }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: theme['q-accent-text'] }]} /> : null}</View>
          </View>
          <Text size={11} color={theme['q-text-secondary']}>{t(`player_appearance_${value}_hint`)}</Text>
        </Button>
      })}
    </View>
    <Text size={11} color={theme['q-text-secondary']} style={styles.hint}>{t('player_appearance_hint')}</Text>
  </View>
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 15, paddingVertical: 12, alignSelf: 'stretch' },
  heading: { fontWeight: '600', marginBottom: 12 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  option: { flex: 1, minWidth: 140, maxWidth: 360, padding: 12, borderWidth: 1, borderRadius: 16 },
  preview: { height: 64, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 14 },
  artwork: { width: 44, height: 44, borderRadius: 8 },
  lines: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 6 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  hint: { marginTop: 10, lineHeight: 17 },
})
