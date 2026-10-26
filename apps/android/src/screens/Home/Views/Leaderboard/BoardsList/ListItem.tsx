import { useCallback, useRef } from 'react'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import Button, { type BtnType } from '@/components/common/Button'
import { createStyle } from '@/utils/tools'
import { type BoardItem } from '@/store/leaderboard/state'

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

  return (
    <Button
      ref={buttonRef}
      accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ ...styles.button, borderColor: active ? theme['q-outline'] : 'transparent', backgroundColor: active ? theme['q-surface-tint'] : index == longPressIndex ? theme['c-button-background-active'] : undefined }}
      key={item.id} onLongPress={setPosition}
      onPress={() => { onBoundChange(item) }}
    >
      <Text style={styles.number} size={11} color={active ? theme['q-accent-text'] : theme['q-text-secondary']}>{String(index + 1).padStart(2, '0')}</Text>
      <Text style={styles.listName} size={14} textBreakStrategy="simple" color={active ? theme['c-primary-font-active'] : theme['c-font']} numberOfLines={1}>{item.name}</Text>
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
