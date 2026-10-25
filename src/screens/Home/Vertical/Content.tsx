import { View } from 'react-native'
import Main from './Main'
import StatusBar from '@/components/common/StatusBar'
import { useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import ConnectionStatus from '@/service/ConnectionStatus'

const Content = () => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()

  return (
    <View style={{ flex: 1 }}>
      <StatusBar />
      <View style={{ height: statusBarHeight, backgroundColor: theme['q-surface-raised'] }} />
      <ConnectionStatus />
      <Main />
    </View>
  )
}

export default Content
