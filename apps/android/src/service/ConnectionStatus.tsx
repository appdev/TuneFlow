import { View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { setNavActiveId } from '@/core/common'
import { checkService } from './session'
import { useServiceStatus } from './useSession'

export default () => {
  const status = useServiceStatus()
  const theme = useTheme()
  if (status.connected) return null
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: theme['q-surface-tint'], paddingHorizontal: 14, paddingVertical: 8, gap: 6 }}>
    <Text size={12}>{status.busy ? '正在连接…' : status.error || '尚未连接'}</Text>
    <View style={{ flexDirection: 'row', gap: 16 }}>
      <Button disabled={status.busy} onPress={() => { void checkService(true) }} style={{ minHeight: 40, justifyContent: 'center' }}><Text size={12}>重新连接</Text></Button>
      <Button onPress={() => { global.lx.settingActiveId = 'service'; setNavActiveId('nav_setting') }} style={{ minHeight: 40, justifyContent: 'center' }}><Text size={12}>连接设置</Text></Button>
    </View>
  </View>
}
