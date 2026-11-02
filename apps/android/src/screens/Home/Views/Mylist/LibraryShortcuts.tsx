import { View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { setActiveList } from '@/core/list'
import { setNavActiveId } from '@/core/common'
import { LIBRARY_ID, HISTORY_ID } from '@/service/workspace'
import { scanServiceLibrary } from '@/service/session'
import { toast } from '@/utils/tools'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

export default () => {
  const theme = useTheme()
  const { phone } = useAdaptiveLayout()
  const items = [
    { id: LIBRARY_ID, icon: 'album', label: '音乐库' },
    { id: 'love', icon: 'love', label: '我喜欢' },
    { id: HISTORY_ID, icon: 'available_updates', label: '播放历史' },
  ]
  if (phone) return <View style={{ paddingHorizontal: 20 }}>
    {[items[1], items[2], { id: 'download', icon: 'download-2', label: '下载' }, items[0]].map(item => <Button key={item.id} accessibilityLabel={item.label} style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderBottomColor: theme['q-outline'] }} onPress={() => {
      if (item.id === 'download') setNavActiveId('download')
      else { setActiveList(item.id); global.app_event.changeLoveListVisible(false) }
    }}><Icon name={item.icon} rawSize={21} color={theme[item.id === 'love' ? 'q-accent-text' : 'q-text-primary']} /><Text size={14} style={{ flex: 1 }}>{item.label}</Text><Icon name="chevron-right" rawSize={16} color={theme['q-text-secondary']} /></Button>)}
    <Button accessibilityLabel="刷新音乐库" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' }} onPress={() => { void scanServiceLibrary().then(() => { setActiveList(LIBRARY_ID); global.app_event.changeLoveListVisible(false) }).catch(() => { toast('音乐库刷新失败，请检查服务器连接') }) }}><Text size={12} color={theme['q-text-secondary']}>刷新音乐库</Text></Button>
  </View>
  return <View style={{ padding: 12, gap: 8 }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map(item => <Button key={item.id} accessibilityLabel={item.label} onPress={() => { setActiveList(item.id) }} style={{ flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: theme['q-surface-tint'] }}>
        <Icon name={item.icon} size={20} color={theme['q-accent-text']} /><Text size={12}>{item.label}</Text>
      </Button>)}
    </View>
    <View style={{ flexDirection: 'row', gap: 16 }}>
      <Button accessibilityLabel="我的歌单" onPress={() => { global.app_event.changeLoveListVisible(true) }} style={{ minHeight: 44, justifyContent: 'center' }}><Text size={12}>我的歌单</Text></Button>
      <Button accessibilityLabel="下载" onPress={() => { setNavActiveId('download') }} style={{ minHeight: 44, justifyContent: 'center' }}><Text size={12}>下载</Text></Button>
      <Button accessibilityLabel="刷新音乐库" onPress={() => { void scanServiceLibrary().then(() => { setActiveList(LIBRARY_ID) }).catch(() => { toast('音乐库刷新失败，请检查服务器连接') }) }} style={{ minHeight: 44, justifyContent: 'center' }}><Text size={12}>刷新音乐库</Text></Button>
    </View>
  </View>
}
