import { useEffect, useState, type PropsWithChildren } from 'react'
import { Keyboard, View } from 'react-native'
import ConnectionSetup from './ConnectionSetup'
import { useServiceStatus } from './useSession'

export default ({ children, onOpenSettings }: PropsWithChildren<{ onOpenSettings?: () => void }>) => {
  const status = useServiceStatus()
  const [loaded, setLoaded] = useState(status.connected)
  useEffect(() => {
    if (status.connected) setLoaded(true)
    else Keyboard.dismiss()
  }, [status.connected])
  return <View style={{ flexGrow: 1 }}>
    {!status.connected ? <ConnectionSetup onOpenSettings={onOpenSettings} /> : null}
    {loaded || status.connected ? <View pointerEvents={status.connected ? 'auto' : 'none'} importantForAccessibility={status.connected ? 'auto' : 'no-hide-descendants'} style={{ flexGrow: 1, opacity: status.connected ? 1 : 0.55 }}>{children}</View> : null}
  </View>
}
