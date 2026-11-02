import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import MyList from './MyList'
import MusicList from './MusicList'
import LibraryShortcuts from './LibraryShortcuts'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import commonState from '@/store/common/state'

export default () => {
  const [tracks, setTracks] = useState(false)
  const theme = useTheme()
  useEffect(() => {
    const show = (visible: boolean) => { if (commonState.navActiveId === 'nav_love') setTracks(!visible) }
    const jump = () => { setTracks(true) }
    global.app_event.on('changeLoveListVisible', show)
    global.app_event.on('jumpListPosition', jump)
    return () => { global.app_event.off('changeLoveListVisible', show); global.app_event.off('jumpListPosition', jump) }
  }, [])
  useBackHandler(useCallback(() => {
    if (commonState.navActiveId !== 'nav_love' || !tracks) return false
    setTracks(false)
    return true
  }, [tracks]))
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1, display: tracks ? 'flex' : 'none' }} accessibilityElementsHidden={!tracks} importantForAccessibility={tracks ? 'auto' : 'no-hide-descendants'}>
      <Button accessibilityLabel="返回我的歌单" style={{ minHeight: 44, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => { setTracks(false) }}><Icon name="chevron-left" rawSize={18} color={theme['q-text-primary']} /><Text size={13}>我的歌单</Text></Button>
      <MusicList />
    </View>
    <View style={{ flex: 1, display: tracks ? 'none' : 'flex' }} accessibilityElementsHidden={tracks} importantForAccessibility={tracks ? 'no-hide-descendants' : 'auto'}><LibraryShortcuts /><MyList embedded /></View>
  </View>
}
