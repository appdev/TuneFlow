import { ScrollView, View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { setNavActiveId } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import commonState from '@/store/common/state'
import ServerSettings from './ServerSettings'
import { checkService } from './session'
import { useServiceStatus } from './useSession'

export default ({ onOpenSettings }: { onOpenSettings?: () => void }) => {
  const status = useServiceStatus()
  const theme = useTheme()
  const settings = (id: 'service' | 'basic') => {
    global.lx.settingActiveId = id
    if (commonState.navActiveId === 'nav_setting') global.state_event.navActiveIdUpdated('nav_setting')
    else setNavActiveId('nav_setting')
    onOpenSettings?.()
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Text size={22}>{status.hasConnected ? '连接暂时不可用' : '先连接音乐服务'}</Text>
    <Text size={13}>{status.hasConnected ? '页面和已输入的内容会保留，连接恢复后即可继续。' : '连接后即可使用搜索、音乐库、歌单和下载；音乐平台账号可稍后登录。'}</Text>
    {!status.hasConnected ? <ServerSettings /> : <View style={{ gap: 10 }}>
      <Text size={13}>{status.error || '正在尝试恢复连接…'}</Text>
      <Button disabled={status.busy} onPress={() => { void checkService(true) }} style={{ padding: 12 }}><Text color={theme['q-accent-text']}>{status.busy ? '正在连接…' : '重新连接'}</Text></Button>
      <Button onPress={() => { settings('service') }} style={{ padding: 12 }}><Text>连接设置</Text></Button>
    </View>}
    <Button onPress={() => { settings('basic') }} style={{ padding: 12 }}><Text>调整外观与本机设置</Text></Button>
  </ScrollView>
}
