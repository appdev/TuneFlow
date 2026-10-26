import { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { useIsPlay } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import TransportButton from '@/components/player/TransportButton'
import PlayQueue, { type PlayQueueType } from '@/components/player/PlayQueue'
import PlayModeBtn from './MoreBtn/PlayModeBtn'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

export default () => {
  const { width, height } = useWindowSize()
  const isPlay = useIsPlay()
  const { isCar } = useAdaptiveLayout()
  const queueRef = useRef<PlayQueueType>(null)
  const size = isCar ? (width < 360 ? 64 : 72) : width < 360 || height < 700 ? 56 : 60
  const targetSize = isCar ? (width < 360 ? 52 : 64) : 48
  return <View style={styles.container}>
    <PlayModeBtn />
    <TransportButton icon="prevMusic" label={global.i18n.t('play_prev')} size={targetSize} iconSize={isCar ? 30 : 24} onPress={() => { void playPrev() }} />
    <TransportButton icon={isPlay ? 'pause' : 'play'} label={global.i18n.t(isPlay ? 'pause' : 'play')} primary size={size} faceSize={size - 10} iconSize={24} onPress={togglePlay} />
    <TransportButton icon="nextMusic" label={global.i18n.t('play_next')} size={targetSize} iconSize={isCar ? 30 : 24} onPress={() => { void playNext() }} />
    <TransportButton icon="menu" label={global.i18n.t('play_queue_title')} size={targetSize} iconSize={isCar ? 26 : 21} onPress={() => { queueRef.current?.show() }} />
    <PlayQueue ref={queueRef} />
  </View>
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
})
