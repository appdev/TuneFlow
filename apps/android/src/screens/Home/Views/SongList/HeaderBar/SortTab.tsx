import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ScrollView } from 'react-native'
import songlistState, { type SortInfo, type Source } from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import Button from '@/components/common/Button'
import { Q_UI } from '@/theme/ui'

export interface SortTabProps {
  onSortChange: (id: string) => void
}

export interface SortTabType {
  setSource: (source: Source, activeTab: SortInfo['id']) => void
}


export default forwardRef<SortTabType, SortTabProps>(({ onSortChange }, ref) => {
  const [sortList, setSortList] = useState<SortInfo[]>([])
  const [activeId, setActiveId] = useState<SortInfo['id']>('')
  const t = useI18n()
  const theme = useTheme()
  const scrollViewRef = useRef<ScrollView>(null)

  useImperativeHandle(ref, () => ({
    setSource(source, activeTab) {
      scrollViewRef.current?.scrollTo({ x: 0 })
      setSortList(songlistState.sortList[source]!)
      setActiveId(activeTab)
    },
  }))

  const sorts = useMemo(() => {
    return sortList.map(s => ({ label: t(`songlist_${s.tid}`), id: s.id }))
  }, [sortList, t])

  const handleSortChange = (id: string) => {
    if (id == activeId) return
    onSortChange(id)
    setActiveId(id)
  }

  return (
    <ScrollView ref={scrollViewRef} style={styles.container} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps={'always'} horizontal>
      {
        sorts.map(s => (
          <Button
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: activeId == s.id }}
            style={[styles.button, { backgroundColor: activeId == s.id ? theme['q-surface-tint'] : 'transparent' }]}
            onPress={() => { handleSortChange(s.id) }}
            key={s.id}
          >
            <Text style={styles.buttonText} color={activeId == s.id ? theme['q-accent-text'] : theme['q-text-secondary']}>{s.label}</Text>
          </Button>
        ))
      }
    </ScrollView>
  )
})


const styles = createStyle({
  container: {
    flexGrow: 1,
    flexShrink: 1,
    // paddingLeft: 5,
    // paddingRight: 5,
  },
  button: {
    borderRadius: 12,
    marginRight: 4,
    minHeight: Q_UI.touchSize,
    // height: 38,
    // lineHeight: 38,
    justifyContent: 'center',
    paddingLeft: 14,
    paddingRight: 14,
    // width: 80,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  buttonText: {
    // height: 38,
    // lineHeight: 38,
    textAlign: 'center',
    paddingHorizontal: 2,
    paddingVertical: 3,
  },
})
