import { useRef } from 'react'
import { ScrollView, View } from 'react-native'
import NavList from './NavList'
import Main, { type MainType } from '../Main'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'row',
    borderTopWidth: BorderWidths.normal,
  },
  nav: {
    height: '100%',
    borderRightWidth: BorderWidths.normal,
  },
  main: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 15,
    paddingBottom: 15,
    flex: 0,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
})

export default () => {
  const theme = useTheme()
  const { width, railWidth } = useAdaptiveLayout()
  const mainRef = useRef<MainType>(null)
  const scrollRef = useRef<ScrollView>(null)

  return (
    <View style={{ ...styles.container, borderTopColor: theme['c-border-background'] }}>
      <View
        style={{
          ...styles.nav,
          width: Math.min(216, Math.max(144, (width - railWidth) * 0.22)),
          backgroundColor: theme['q-surface-base'],
          borderRightColor: theme['q-outline'],
        }}
      >
        <NavList onChangeId={(id) => {
          mainRef.current?.setActiveId(id)
          scrollRef.current?.scrollTo({ y: 0, animated: false })
        }} />
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.main}>
          <Main ref={mainRef} />
        </View>
      </ScrollView>
    </View>
  )
}
