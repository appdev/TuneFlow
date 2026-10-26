import { memo, useEffect, useState } from 'react'
import { Keyboard, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import { createStyle, getIsSupportedAutoTheme } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getThemeAppearance, type ThemeAppearance } from '@/theme/appearance'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import Input from '@/components/common/Input'
import { getThemeSchedule, isValidSchedule } from '@/theme/schedule'

const isSupportedAutoTheme = getIsSupportedAutoTheme()

const Schedule = () => {
  const t = useI18n()
  const theme = useTheme()
  const savedDay = useSettingValue('theme.dayStart')
  const savedNight = useSettingValue('theme.nightStart')
  const [dayStart, setDayStart] = useState(savedDay)
  const [nightStart, setNightStart] = useState(savedNight)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const schedule = getThemeSchedule({ 'theme.dayStart': savedDay, 'theme.nightStart': savedNight })
    setDayStart(schedule.dayStart)
    setNightStart(schedule.nightStart)
  }, [savedDay, savedNight])
  const valid = isValidSchedule(dayStart, nightStart)
  const changed = dayStart != savedDay || nightStart != savedNight
  const save = () => {
    if (!valid) return
    Keyboard.dismiss()
    updateSetting({ 'theme.dayStart': dayStart, 'theme.nightStart': nightStart })
    setSaved(true)
  }
  return <View style={styles.schedule}>
    <View style={styles.timeRow}>
      {([{ label: 'theme_schedule_day', value: dayStart, change: setDayStart }, { label: 'theme_schedule_night', value: nightStart, change: setNightStart }] as const).map(field => <View key={field.label} style={styles.timeField}>
        <Text size={12} color={theme['q-text-secondary']}>{t(field.label)}</Text>
        <Input value={field.value} onChangeText={value => { field.change(value); setSaved(false) }} accessibilityLabel={t(field.label)} placeholder="HH:mm" maxLength={5} autoCorrect={false} autoCapitalize="none" returnKeyType="done" onSubmitEditing={save} style={styles.timeInput} />
      </View>)}
    </View>
    <Button onPress={save} disabled={!valid || !changed} style={[styles.saveTime, { borderColor: theme['q-outline'], opacity: valid && changed ? 1 : 0.45 }]}>
      <Text size={13} color={theme['q-accent']}>{t('theme_schedule_save')}</Text>
    </Button>
    {!valid || saved ? <Text accessibilityLiveRegion="polite" size={12} color={theme['q-text-secondary']} style={styles.tip}>{t(valid ? 'theme_schedule_saved' : 'theme_schedule_invalid')}</Text> : null}
  </View>
}

export default memo(() => {
  const t = useI18n()
  const isAutoTheme = useSettingValue('common.isAutoTheme')
  const autoByTime = useSettingValue('theme.autoByTime')
  const appearance = useSettingValue('theme.appearance')
  const themeId = useSettingValue('theme.id')
  const theme = useTheme()
  const mode = getThemeAppearance({ 'theme.appearance': appearance, 'theme.id': themeId, 'theme.autoByTime': autoByTime, 'common.isAutoTheme': isAutoTheme }, theme.isDark)
  const modes: ThemeAppearance[] = isSupportedAutoTheme ? ['light', 'dark', 'system', 'time'] : ['light', 'dark', 'time']

  return (
    <SubTitle title={t('theme_appearance')}>
      <View style={styles.content}>
        {modes.map(item => <Button
          key={item}
          accessibilityRole="radio"
          accessibilityLabel={t(`theme_appearance_${item}`)}
          accessibilityState={{ checked: mode == item }}
          style={styles.option}
          onPress={() => { updateSetting({ 'theme.appearance': item, 'theme.autoByTime': false, 'common.isAutoTheme': false }) }}
        >
          <View style={[styles.preview, { borderColor: mode == item ? theme['q-accent'] : theme['q-outline'], backgroundColor: item == 'dark' ? '#25272d' : '#f4f5f7' }]}>
            {item == 'system' || item == 'time' ? <View style={styles.darkHalf} /> : null}
            <View style={styles.previewSidebar}><View style={styles.bar} /><View style={styles.bar} /><View style={styles.bar} /></View>
            <View style={styles.previewLines}><View style={styles.bar} /><View style={[styles.bar, { width: '65%', backgroundColor: theme['q-accent'] }]} /><View style={styles.bar} /></View>
            {mode == item ? <View style={[styles.dot, { backgroundColor: theme['q-accent'], borderColor: theme['c-content-background'] }]} /> : null}
          </View>
          <Text size={12} color={mode == item ? theme['q-text-primary'] : theme['q-text-secondary']} style={styles.label}>{t(`theme_appearance_${item}`)}</Text>
        </Button>)}
      </View>
      {mode == 'time' ? <Schedule /> : null}
      <Text size={12} color={theme['q-text-secondary']} style={styles.tip}>{t(mode == 'time' ? 'theme_appearance_time_tip' : 'theme_appearance_tip')}</Text>
    </SubTitle>
  )
})

const styles = createStyle({
  schedule: { marginTop: 20, maxWidth: 520 },
  timeRow: { flexDirection: 'row', gap: 12 },
  timeField: { flex: 1, gap: 8 },
  timeInput: { fontVariant: ['tabular-nums'] },
  saveTime: { marginTop: 12, minHeight: 44, paddingHorizontal: 16, borderWidth: 1, borderRadius: 10, alignSelf: 'flex-start', justifyContent: 'center' },
  content: {
    flexDirection: 'row',
    gap: 10,
    maxWidth: 520,
  },
  option: { flex: 1, minWidth: 0, maxWidth: 120, minHeight: 82, borderRadius: 10 },
  preview: { height: 52, borderRadius: 9, borderWidth: 2, padding: 9, flexDirection: 'row', gap: 7, overflow: 'hidden' },
  darkHalf: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', backgroundColor: '#25272d' },
  previewSidebar: { width: 12, gap: 5, paddingRight: 3 },
  previewLines: { flex: 1, gap: 6 },
  bar: { height: 4, borderRadius: 2, backgroundColor: '#a3a8b2' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, right: 4, bottom: 4 },
  label: { textAlign: 'center', marginTop: 9, lineHeight: 18 },
  tip: { marginTop: 13, lineHeight: 19 },
})
