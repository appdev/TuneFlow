import { getSongListSetting, saveSongListSetting } from '@/utils/data'
import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

// import List from './List/List'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import songlistState, { type InitState, type SortInfo } from '@/store/songlist/state'
import List, { type ListType } from './List'


interface SonglistInfo {
  source: InitState['sources'][number]
  sortId: SortInfo['id']
  tagId: string
}

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const listRef = useRef<ListType>(null)
  const songlistInfo = useRef<SonglistInfo>({ source: 'kw', sortId: songlistState.sortList.kw![0].id, tagId: '' })
  const interacted = useRef(false)

  useEffect(() => {
    let cancelled = false
    void getSongListSetting().catch(() => ({ ...songlistInfo.current, tagName: '' })).then(info => {
      if (cancelled || interacted.current) return
      const source = songlistState.sources.includes(info.source) ? info.source : 'kw'
      const sorts = songlistState.sortList[source]!
      const sortId = sorts.some(sort => sort.id == info.sortId) ? info.sortId : sorts[0].id
      const tagId = source == info.source ? info.tagId : ''
      songlistInfo.current = { source, sortId, tagId }
      headerBarRef.current?.setSource(source, sortId, tagId ? info.tagName : '', tagId)
      listRef.current?.loadList(source, sortId, tagId)
    })
    return () => { cancelled = true }
  }, [])

  const handleSortChange: HeaderBarProps['onSortChange'] = (id) => {
    interacted.current = true
    songlistInfo.current.sortId = id
    void saveSongListSetting({ sortId: id })
    listRef.current?.loadList(songlistInfo.current.source, id, songlistInfo.current.tagId)
  }

  const handleTagChange: HeaderBarProps['onTagChange'] = (name, id) => {
    interacted.current = true
    songlistInfo.current.tagId = id
    void saveSongListSetting({ tagName: name, tagId: id })
    listRef.current?.loadList(songlistInfo.current.source, songlistInfo.current.sortId, id)
  }

  const handleSourceChange: HeaderBarProps['onSourceChange'] = (source) => {
    interacted.current = true
    songlistInfo.current.source = source
    songlistInfo.current.tagId = ''
    songlistInfo.current.sortId = songlistState.sortList[source]![0].id
    void saveSongListSetting({ sortId: songlistInfo.current.sortId, source, tagId: '', tagName: '' })
    headerBarRef.current?.setSource(source, songlistInfo.current.sortId, '', songlistInfo.current.tagId)
    listRef.current?.loadList(source, songlistInfo.current.sortId, songlistInfo.current.tagId)
  }

  return (
    <View style={styles.container}>
      <HeaderBar
        ref={headerBarRef}
        onSortChange={handleSortChange}
        onTagChange={handleTagChange}
        onSourceChange={handleSourceChange}
      />
      <List ref={listRef} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
})

