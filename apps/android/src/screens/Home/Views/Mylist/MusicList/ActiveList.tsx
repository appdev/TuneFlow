import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useActiveListId, useListFetching, useMyList } from '@/store/list/hook'
import { createStyle } from '@/utils/tools'
import { getListPrevSelectId } from '@/utils/data'
import { setActiveList } from '@/core/list'
import Text from '@/components/common/Text'
import PlaylistIdentity from '@/components/PlaylistIdentity'
import { LIST_IDS } from '@/config/constant'
import Loading from '@/components/common/Loading'
import { useSettingValue } from '@/store/setting/hook'
import Button from '@/components/common/Button'
import IconButton from '@/components/common/IconButton'

export interface ActiveListProps {
  onShowSearchBar: () => void
  onScrollToTop: () => void
}
export interface ActiveListType {
  setVisibleBar: (visible: boolean) => void
}

export default forwardRef<ActiveListType, ActiveListProps>(({ onShowSearchBar, onScrollToTop }, ref) => {
  const theme = useTheme()
  const currentListId = useActiveListId()
  const lists = useMyList()
  const fetching = useListFetching(currentListId)
  const currentList = lists.find(list => list.id == currentListId)
  const langId = useSettingValue('common.langId')
  const currentListName = useMemo(() => {
    switch (currentListId) {
      case LIST_IDS.TEMP:
        return global.i18n.t('list_name_temp')
      case LIST_IDS.DEFAULT:
        return global.i18n.t('list_name_default')
      case LIST_IDS.LOVE:
        return global.i18n.t('list_name_love')
      default:
        return lists.find(l => l.id === currentListId)?.name ?? ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentListId, langId, lists])
  const [visibleBar, setVisibleBar] = useState(true)

  useImperativeHandle(ref, () => ({
    setVisibleBar(visible) {
      setVisibleBar(visible)
    },
  }))

  const showList = () => {
    global.app_event.changeLoveListVisible(true)
  }

  useEffect(() => {
    void getListPrevSelectId().then((id) => {
      setActiveList(id)
    })
  }, [])

  return (
    <View
      pointerEvents={visibleBar ? 'auto' : 'none'}
      importantForAccessibility={visibleBar ? 'auto' : 'no-hide-descendants'}
      style={{ ...styles.currentList, opacity: visibleBar ? 1 : 0, borderBottomColor: theme['q-outline'] }}
    >
      <Button
        accessibilityLabel={currentListName}
        onPress={showList}
        onLongPress={onScrollToTop}
        style={styles.currentListMain}
      >
        <Icon accessible={false} style={styles.currentListIcon} color={theme['q-text-secondary']} name="menu" size={17} />
        { fetching ? <Loading color={theme['q-accent-text']} style={styles.loading} /> : null }
        {currentList ? <PlaylistIdentity list={currentList} name={currentListName} /> : <Text style={styles.currentListText} numberOfLines={1} color={theme['q-text-primary']}>{currentListName}</Text>}
      </Button>
      <IconButton
        accessibilityLabel={global.i18n.t('list_search')}
        name="search-2"
        iconSize={18}
        iconColor={theme['q-text-secondary']}
        style={styles.currentListBtns}
        onPress={onShowSearchBar}
      />
    </View>
  )
})


const styles = createStyle({
  currentList: {
    flexDirection: 'row',
    paddingRight: 2,
    minHeight: 48,
    height: 48,
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  currentListMain: {
    flex: 1,
    minWidth: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 0,
  },
  currentListIcon: {
    paddingLeft: 15,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 0,
  },
  currentListText: {
    flex: 1,
    minWidth: 0,
    fontWeight: '600',
    // minWidth: 70,
    // paddingLeft: 10,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 10,
  },
  loading: {
    marginRight: 5,
  },
  currentListBtns: {
    width: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  importButton: {
    flexShrink: 0,
    minWidth: 48,
    minHeight: 48,
    height: 48,
    maxWidth: 144,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  importText: {
    marginLeft: 5,
    fontWeight: '600',
  },
})
