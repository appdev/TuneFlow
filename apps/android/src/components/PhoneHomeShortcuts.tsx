import { View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { setNavActiveId } from '@/core/common'
import { setActiveList } from '@/core/list'
import { HISTORY_ID } from '@/service/workspace'
import { pushMusicAccountScreen } from '@/navigation/navigation'
import commonState from '@/store/common/state'

export default () => {
  const theme = useTheme()
  const openList = (id: string) => {
    setActiveList(id)
    setNavActiveId('nav_love')
    requestAnimationFrame(() => { global.app_event.changeLoveListVisible(false) })
  }
  const items = [
    { icon: 'love', label: '我喜欢', press: () => { openList('love') } },
    { icon: 'music_time', label: '最近播放', press: () => { openList(HISTORY_ID) } },
    { icon: 'download-2', label: '下载', press: () => { setNavActiveId('download') } },
    { icon: 'available_updates', label: '平台账号', press: () => { if (commonState.componentIds.home) pushMusicAccountScreen(commonState.componentIds.home) } },
  ]
  return <View style={{ flexDirection: 'row', marginTop: 16 }}>
    {items.map(item => <Button key={item.label} accessibilityLabel={item.label} style={{ flex: 1, minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 8 }} onPress={item.press}><Icon accessible={false} name={item.icon} rawSize={21} color={theme['q-text-primary']} /><Text size={11} color={theme['q-text-secondary']}>{item.label}</Text></Button>)}
  </View>
}
