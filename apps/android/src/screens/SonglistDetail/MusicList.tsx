import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { getListDetail, setListDetail, setListDetailInfo } from '@/core/songlist'
import songlistState from '@/store/songlist/state'
import { handlePlay } from './listAction'
import Header, { type HeaderType } from './Header'
import { useListInfo } from './state'

export interface MusicListProps {
  componentId: string
  onTitleCollapse?: (collapsed: boolean) => void
}

// 歌单标题滚出可视区后，固定栏改为显示歌单名
const TITLE_COLLAPSE_OFFSET = 64

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
}

export default forwardRef<MusicListType, MusicListProps>(({ componentId, onTitleCollapse }, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const collapsedRef = useRef(false)
  const handleScroll: OnlineListProps['onScroll'] = (event) => {
    const collapsed = event.nativeEvent.contentOffset.y > TITLE_COLLAPSE_OFFSET
    if (collapsed == collapsedRef.current) return
    collapsedRef.current = collapsed
    onTitleCollapse?.(collapsed)
  }
  const headerRef = useRef<HeaderType>(null)
  const isUnmountedRef = useRef(false)
  const requestIdRef = useRef(0)
  const info = useListInfo()

  useImperativeHandle(ref, () => ({
    async loadList(source, id) {
      const requestId = ++requestIdRef.current
      const listDetailInfo = songlistState.listDetailInfo
      listRef.current?.setList([])
      if (listDetailInfo.id == id && listDetailInfo.source == source && listDetailInfo.list.length) {
        requestAnimationFrame(() => {
          if (isUnmountedRef.current || requestId != requestIdRef.current) return
          listRef.current?.setList(listDetailInfo.list)
          listRef.current?.setStatus(listDetailInfo.maxPage <= listDetailInfo.page ? 'end' : 'idle')
          headerRef.current?.setInfo({
            name: (info.name || listDetailInfo.info.name) ?? '',
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            desc: listDetailInfo.info.desc || info.desc || '',
            playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
            imgUrl: info.img ?? listDetailInfo.info.img,
          })
        })
      } else {
        listRef.current?.setStatus('loading')
        const page = 1
        setListDetailInfo(source, id)
        headerRef.current?.setInfo({
          name: (info.name || listDetailInfo.info.name) ?? '',
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          desc: listDetailInfo.info.desc || info.desc || '',
          playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
          imgUrl: info.img ?? listDetailInfo.info.img,
        })
        return getListDetail(id, source, page).then((listDetail) => {
          if (isUnmountedRef.current || requestId != requestIdRef.current) return
          const result = setListDetail(listDetail, id, page)
          requestAnimationFrame(() => {
            if (isUnmountedRef.current || requestId != requestIdRef.current) return
            headerRef.current?.setInfo({
              name: (info.name || listDetailInfo.info.name) ?? '',
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              desc: listDetailInfo.info.desc || info.desc || '',
              playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
              imgUrl: info.img ?? listDetailInfo.info.img,
            })
            listRef.current?.setList(result.list)
            listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
          })
        }).catch(() => {
          if (isUnmountedRef.current || requestId != requestIdRef.current) return
          listRef.current?.setStatus('error')
        })
      }
    },
  }))

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])


  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = songlistState.listDetailInfo
    // console.log(songlistState.listDetailInfo)
    void handlePlay(listDetailInfo.id, listDetailInfo.source, listDetailInfo.list, index)
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const requestId = ++requestIdRef.current
    const page = 1
    const { id, source } = songlistState.listDetailInfo
    listRef.current?.setStatus('refreshing')
    getListDetail(id, source, page, true).then((listDetail) => {
      if (isUnmountedRef.current || requestId != requestIdRef.current) return
      const result = setListDetail(listDetail, id, page)
      listRef.current?.setList(result.list)
      listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (isUnmountedRef.current || requestId != requestIdRef.current) return
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    const requestId = ++requestIdRef.current
    listRef.current?.setStatus('loading')
    const { id, source } = songlistState.listDetailInfo
    const page = songlistState.listDetailInfo.list.length ? songlistState.listDetailInfo.page + 1 : 1
    getListDetail(id, source, page).then((listDetail) => {
      if (isUnmountedRef.current || requestId != requestIdRef.current) return
      const result = setListDetail(listDetail, id, page)
      listRef.current?.setList(result.list, true)
      listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (isUnmountedRef.current || requestId != requestIdRef.current) return
      listRef.current?.setStatus('error')
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const header = useMemo(() => <Header ref={headerRef} componentId={componentId} />, [])

  return <OnlineList
    ref={listRef}
    onPlayList={handlePlayList}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
    ListHeaderComponent={header}
    onScroll={onTitleCollapse ? handleScroll : undefined}
    // progressViewOffset={}
   />
})

