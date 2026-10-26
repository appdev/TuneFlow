import { StyleSheet, View } from 'react-native'
import Header from './Vertical/components/Header'
import Pic from './Vertical/Pic'
import Lyric from './Vertical/Lyric'
import PlayBg from './Vertical/PlayBg'
import PlayInfo from './Vertical/Player/components/PlayInfo'
import ControlBtn from './Vertical/Player/components/ControlBtn'
import MoreBtn from './Vertical/Player/components/MoreBtn'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
import { useTheme } from '@/store/theme/hook'
import useKeepLyricsAwake from './useKeepLyricsAwake'

export default ({ componentId }: { componentId: string }) => {
  const { isCar, width, height } = useAdaptiveLayout()
  const compact = height < 540
  const theme = useTheme()
  useKeepLyricsAwake()

  return <>
    <PlayBg lyricActive />
    <Header />
    <View style={[styles.body, { paddingHorizontal: compact ? 12 : 28 }]}>
      <View style={styles.artwork}>
        <View style={[styles.artworkGroup, { maxHeight: compact ? 340 : 580 }]}>
          <Pic componentId={componentId} wide />
          <MoreBtn />
        </View>
      </View>
      <View style={[styles.lyrics, { borderLeftColor: theme['q-outline'] }]}><Lyric wide /></View>
    </View>
    <View style={[styles.footer, { borderColor: theme['q-outline'], backgroundColor: theme['q-surface-raised'], marginHorizontal: compact ? 16 : 28 }]}>
      <View style={styles.progress}><PlayInfo /></View>
      <View style={{ width: Math.min(width * 0.54, isCar ? 420 : 380) }}><ControlBtn /></View>
    </View>
  </>
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0, flexDirection: 'row', paddingBottom: 8, width: '100%', maxWidth: 1440, alignSelf: 'center' },
  artwork: { width: '43%', minWidth: 0, justifyContent: 'center', alignItems: 'center' },
  artworkGroup: { width: '100%', flex: 1 },
  lyrics: { flex: 1, minWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 4, gap: 20, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, marginBottom: 10 },
  progress: { flex: 1, minWidth: 0, height: 56 },
})
