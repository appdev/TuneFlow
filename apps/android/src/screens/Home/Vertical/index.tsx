import Content from './Content'
import PlayerBar from '@/components/player/PlayerBar'
import BottomNav from './BottomNav'
import PhoneBottomNav from './PhoneBottomNav'
import { useTheme } from '@/store/theme/hook'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { DockInsetContext } from '@/components/common/DockInset'
import Aside from '../Horizontal/Aside'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

export default () => {
  const [dockHeight, setDockHeight] = useState(0)
  const { wide, phone } = useAdaptiveLayout()
  const theme = useTheme()
  return (
    <DockInsetContext.Provider value={wide ? 0 : dockHeight}>
      <View style={styles.shell}>
        {wide ? <Aside /> : null}
        <View style={styles.main}>
          <Content />
          <View pointerEvents="box-none" style={[wide ? styles.wideDock : styles.dock, phone && { backgroundColor: theme['q-surface-base'] }]} onLayout={event => { setDockHeight(event.nativeEvent.layout.height) }}>
            <PlayerBar isHome />
            {!wide ? phone ? <PhoneBottomNav /> : <BottomNav /> : null}
          </View>
        </View>
      </View>
    </DockInsetContext.Provider>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  wideDock: { paddingTop: 8, flexShrink: 0 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 8 },
})
