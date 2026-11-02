import { useCallback, useEffect, useRef, useState } from 'react'
import ListText from '@/components/common/ListText'
import { useTheme } from '@/store/theme/hook'
import Button, { type BtnType } from '@/components/common/Button'
import { createStyle } from '@/utils/tools'
import { type BoardItem } from '@/store/leaderboard/state'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
import { View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { getListDetail } from '@/core/leaderboard'
import DailyArtwork from '@/screens/Home/Views/Search/BlankView/DailyArtwork'

// index={index}
// longPressIndex={longPressIndex}
// activeId={activeId}
// showMenu={showMenu}
// onBoundChange={handleBoundChange}
export interface ListItemProps {
  item: BoardItem
  index: number
  longPressIndex: number
  activeId: string
  onShowMenu: (id: string, name: string, index: number, position: { x: number, y: number, w: number, h: number }) => void
  onBoundChange: (item: BoardItem) => void
}

export default ({ item, activeId, index, longPressIndex, onBoundChange, onShowMenu }: ListItemProps) => {
  const theme = useTheme()
  const { phone } = useAdaptiveLayout()
  const [preview, setPreview] = useState<LX.Music.MusicInfoOnline[]>([])
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => {
    if (!phone || index >= 3) return
    let active = true
    setPreview([])
    setPreviewFailed(false)
    // Reuse the existing read-only page cache; previews never select the board.
    void getListDetail(item.id, 1).then(result => { if (active) setPreview(result.list.slice(0, 3)) }).catch(() => { if (active) setPreviewFailed(true) })
    return () => { active = false }
  }, [phone, index, item.id])
  const buttonRef = useRef<BtnType>(null)

  const setPosition = useCallback(() => {
    if (buttonRef.current?.measure) {
      buttonRef.current.measure((fx, fy, width, height, px, py) => {
        // console.log(fx, fy, width, height, px, py)
        onShowMenu(item.id, item.name, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }, [index, item, onShowMenu])

  const active = activeId == item.id

  if (phone && index < 3) return <Button ref={buttonRef} accessibilityLabel={item.name} accessibilityState={{ selected: active }} onPress={() => { onBoundChange(item) }} onLongPress={setPosition} style={{ marginHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: theme['q-outline'] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 54, height: 54, borderRadius: 12, overflow: 'hidden' }}><DailyArtwork item={preview[0]} /></View>
      <ListText style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>{item.name}</ListText>
      <Icon name="chevron-right" rawSize={18} color={theme['q-text-secondary']} />
    </View>
    {preview.length ? <View style={{ marginTop: 8 }}>{preview.map((track, rank) => <View key={`${track.source}_${track.id}`} style={{ flexDirection: 'row', gap: 8, minHeight: 30, alignItems: 'center' }}><ListText secondary style={{ width: 22 }}>{String(rank + 1).padStart(2, '0')}</ListText><ListText style={{ flex: 1 }} numberOfLines={1}>{track.name}</ListText></View>)}</View> : <ListText secondary style={{ marginTop: 12 }} numberOfLines={1}>{previewFailed ? '预览暂不可用，点击查看榜单' : '正在加载榜单预览…'}</ListText>}
  </Button>

  return (
    <Button
      ref={buttonRef}
      accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ ...styles.button, ...(phone ? { minHeight: 84, marginHorizontal: 20, marginVertical: 0, borderWidth: 0, borderRadius: 0, borderBottomWidth: 0.5, borderBottomColor: theme['q-outline'], paddingHorizontal: 0, gap: 12 } : {}), borderColor: active ? theme['q-outline'] : 'transparent', backgroundColor: active ? theme['q-surface-tint'] : index == longPressIndex ? theme['c-button-background-active'] : undefined }}
      key={item.id} onLongPress={setPosition}
      onPress={() => { onBoundChange(item) }}
    >
      {phone ? <View style={{ width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme['q-surface-raised'] }}><Icon name="leaderboard" rawSize={25} color={theme['q-accent-text']} /></View> : <ListText style={styles.number} secondary>{String(index + 1).padStart(2, '0')}</ListText>}
      <ListText style={styles.listName} active={active} textBreakStrategy="simple" numberOfLines={1}>{item.name}</ListText>
      {phone ? <Icon name="chevron-right" rawSize={18} color={theme['q-text-secondary']} /> : null}
    </Button>
  )
}

const styles = createStyle({
  button: {
    minHeight: 48,
    marginHorizontal: 8,
    marginVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  number: { width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
  listName: {
    flex: 1,
    justifyContent: 'center',
    paddingLeft: 6,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
})
