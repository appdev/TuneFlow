import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Main, { settingTitle, type SettingScreenIds } from './Main'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useDockInset } from '@/components/common/DockInset'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { getThemeAppearance } from '@/theme/appearance'
import settingState from '@/store/setting/state'
import commonState from '@/store/common/state'

const groups: Array<{ title: string, items: Array<{ id: SettingScreenIds, icon: string }> }> = [
  { title: '外观', items: [{ id: 'basic', icon: 'phone-appearance' }] },
  { title: '音乐与播放', items: [{ id: 'accounts', icon: 'available_updates' }, { id: 'sources', icon: 'album' }, { id: 'player', icon: 'play' }, { id: 'lyric_desktop', icon: 'lyric-on' }, { id: 'search', icon: 'search-2' }, { id: 'list', icon: 'menu' }] },
  { title: '应用', items: [{ id: 'service', icon: 'cloud-library' }, { id: 'downloads', icon: 'download-2' }, { id: 'compatibility', icon: 'list-loop' }, { id: 'other', icon: 'setting' }, { id: 'version', icon: 'available_updates' }, { id: 'about', icon: 'help' }] },
]

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const dock = useDockInset()
  const [section, setSection] = useState<SettingScreenIds | null>(() => global.lx.settingActiveId === 'basic' ? null : global.lx.settingActiveId)
  const lastSection = useRef(global.lx.settingActiveId)
  const scroll = useRef<ScrollView>(null)
  const appearance = useSettingValue('theme.appearance')
  const mode = appearance ?? getThemeAppearance(settingState.setting, theme.isDark)
  const returnToIndex = useCallback(() => {
    global.lx.settingActiveId = 'basic'
    lastSection.current = 'basic'
    setSection(null)
    requestAnimationFrame(() => { scroll.current?.scrollTo({ y: 0, animated: false }) })
  }, [])
  const open = (id: SettingScreenIds) => {
    global.lx.settingActiveId = id
    lastSection.current = id
    setSection(id)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  useEffect(() => {
    const handleNavigation = (id: string) => {
      if (id === 'nav_setting' && global.lx.settingActiveId !== lastSection.current) {
        lastSection.current = global.lx.settingActiveId
        setSection(global.lx.settingActiveId === 'basic' ? null : global.lx.settingActiveId)
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavigation)
    return () => { global.state_event.off('navActiveIdUpdated', handleNavigation) }
  }, [])
  useBackHandler(useCallback(() => {
    if (commonState.navActiveId !== 'nav_setting' || section === null) return false
    returnToIndex()
    return true
  }, [section, returnToIndex]))
  return <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: dock + 24 }} keyboardShouldPersistTaps="handled">
    {section ? <>
      <Button accessibilityLabel="返回设置目录" style={styles.back} onPress={returnToIndex}><Icon name="chevron-left" rawSize={18} color={theme['q-text-primary']} /><Text size={14} color={theme['q-text-primary']}>设置目录</Text></Button>
      <Main key={section} />
    </> : groups.map(group => <View key={group.title} style={styles.group}>
      <Text size={12} color={theme['q-text-secondary']} style={styles.label}>{group.title}</Text>
      {group.title === '外观' ? <View style={styles.appearance}>
        {(['light', 'dark', 'system'] as const).map((value, i) => <Button key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} accessibilityLabel={['浅色', '深色', '跟随系统'][i]} style={[styles.mode, { borderColor: mode === value ? theme['q-accent-text'] : theme['q-outline'] }]} onPress={() => { updateSetting({ 'theme.appearance': value, 'theme.autoByTime': false, 'common.isAutoTheme': false }) }}>
          <Icon name={i === 0 ? 'phone-sun' : i === 1 ? 'phone-moon' : 'phone-appearance'} rawSize={21} color={theme[mode === value ? 'q-accent-text' : 'q-text-secondary']} />
          <Text size={12} color={theme[mode === value ? 'q-accent-text' : 'q-text-secondary']}>{['浅色', '深色', '跟随系统'][i]}</Text>
        </Button>)}
      </View> : null}
      {group.items.map(item => <Button key={item.id} accessibilityLabel={settingTitle(item.id, t)} style={[styles.row, { borderBottomColor: theme['q-outline'] }]} onPress={() => { open(item.id) }}>
        <Icon accessible={false} name={item.icon} rawSize={20} color={theme['q-text-primary']} />
        <Text style={styles.rowText} size={14} color={theme['q-text-primary']}>{settingTitle(item.id, t)}</Text>
        <Icon accessible={false} name="chevron-right" rawSize={16} color={theme['q-text-secondary']} />
      </Button>)}
    </View>)}
  </ScrollView>
}
const styles = StyleSheet.create({
  group: { marginTop: 24 }, label: { marginBottom: 8 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 }, back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  appearance: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  mode: { flex: 1, minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12 },
})
