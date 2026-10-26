import { View, StyleSheet } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

const modes = ['auto', 'phone', 'tablet', 'car'] as const

export default () => {
  const mode = useSettingValue('common.displayMode')
  const theme = useTheme()
  const t = useI18n()
  return <SubTitle title={t('setting_display_mode')}>
    <View style={styles.options}>
      {modes.map(value => <Button
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ checked: mode == value }}
        onPress={() => { updateSetting({ 'common.displayMode': value }) }}
        style={[styles.option, { backgroundColor: mode == value ? theme['q-surface-tint'] : theme['q-surface-raised'], borderColor: mode == value ? theme['q-accent'] : theme['q-outline'] }]}
      ><Text size={14} color={mode == value ? theme['q-accent-text'] : theme['q-text-primary']}>{t(`setting_display_${value}`)}</Text></Button>)}
    </View>
    <Text size={12} color={theme['q-text-secondary']} style={styles.hint}>{t('setting_display_hint')}</Text>
  </SubTitle>
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 52, minWidth: 80, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: 10, lineHeight: 20 },
})
