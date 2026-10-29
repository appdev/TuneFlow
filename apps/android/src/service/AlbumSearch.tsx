import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'
import Text from '@/components/common/Text'
import ListText from '@/components/common/ListText'
import Button from '@/components/common/Button'
import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import { useTheme } from '@/store/theme/hook'
import { useDockInset } from '@/components/common/DockInset'
import { playFromPage } from '@/core/player/selection'
import { type MusicListType } from '@/screens/Home/Views/Search/MusicList'
import { getWorkspace } from './session'
import { type CollectionDto } from './client'

export const ALBUM_SOURCES = ['all', 'tx', 'wy', 'kg'] as const
export default forwardRef<MusicListType>((props, ref) => {
  const theme = useTheme()
  const dockInset = useDockInset()
  const request = useRef({ text: '', source: 'all', page: 1, revision: 0 })
  const list = useRef<OnlineListType>(null)
  const [albums, setAlbums] = useState<CollectionDto[]>([])
  const [selected, setSelected] = useState<CollectionDto | null>(null)
  const [tracks, setTracks] = useState<LX.Music.MusicInfoOnline[]>([])
  const [busy, setBusy] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const load = async(page = 1) => {
    const info = request.current
    const revision = ++info.revision
    const workspace = getWorkspace()
    setBusy(true); setError('')
    try {
      const sources = info.source === 'all' ? ALBUM_SOURCES.filter(source => source !== 'all') : [info.source]
      const results = await Promise.allSettled(sources.map(async source => workspace.search(source, info.text, page, 20, 'albums')))
      if (!active.current || revision !== request.current.revision || workspace !== getWorkspace()) return
      const successful = results.filter(result => result.status === 'fulfilled').map(result => result.value)
      if (!successful.length) throw new Error('专辑搜索失败，请检查连接状态')
      const rows = successful.flatMap(result => result.list as unknown as CollectionDto[])
      setAlbums(previous => page === 1 ? rows : [...previous, ...rows])
      setHasMore(successful.some(result => page * result.limit < (result.total ?? 0)))
      request.current.page = page
      if (successful.length !== results.length) setError('部分平台暂不可用，已显示其他平台的结果。')
    } catch (e) { if (active.current && revision === request.current.revision) setError(e instanceof Error ? e.message : '专辑搜索失败') } finally { if (revision === request.current.revision) setBusy(false) }
  }
  useImperativeHandle(ref, () => ({
    loadList(text, source) {
      request.current = { text, source: (ALBUM_SOURCES as readonly string[]).includes(source) ? source : 'all', page: 1, revision: request.current.revision + 1 }
      setSelected(null); setAlbums([]); setTracks([]); void load()
    },
  }))
  useEffect(() => { active.current = true; return () => { active.current = false; request.current.revision++ } }, [])
  useEffect(() => { if (selected) { list.current?.setList(tracks, false, true); list.current?.setStatus('end') } }, [selected, tracks])
  const open = async(album: CollectionDto) => {
    if (busy) return
    const workspace = getWorkspace()
    setBusy(true); setError('')
    try {
      const tracks = await workspace.album(album.source, album.id)
      if (active.current && workspace === getWorkspace()) { setTracks(tracks); setSelected(album) }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : '专辑加载失败') } finally { if (active.current) setBusy(false) }
  }
  const button = (label: string, onPress: () => void, disabled = busy) => <Button accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}><Text size={13}>{label}</Text></Button>
  if (selected) {
    return <View style={{ flex: 1 }}>
    <View style={{ padding: 12, gap: 6 }}>{button('返回专辑结果', () => { setSelected(null) }, false)}<Text size={18}>{selected.name}</Text><Text size={12}>{selected.author}</Text>{error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>
    <OnlineList ref={list} onRefresh={() => { void open(selected) }} onLoadMore={() => { list.current?.setStatus('end') }} onPlayList={index => { void playFromPage(`service_album:${selected.source}:${selected.id}`, tracks, index) }} />
  </View>
  }
  return <FlatList data={albums} keyExtractor={item => `${item.source}:${item.id}`} contentContainerStyle={{ padding: 16, paddingBottom: 24 + dockInset }}
    ListHeaderComponent={error ? <Text accessibilityRole="alert">{error}</Text> : null}
    ListEmptyComponent={<Text>{busy ? '正在搜索专辑…' : '暂无专辑结果'}</Text>}
    renderItem={({ item }) => <Button accessibilityLabel={`打开专辑 ${item.name}`} disabled={busy} onPress={() => { void open(item) }} style={{ paddingVertical: 18, gap: 6, borderBottomWidth: 1, borderColor: theme['q-outline'] }}><ListText numberOfLines={2}>{item.name}</ListText><ListText secondary numberOfLines={1}>{item.author} · {item.source.toUpperCase()}</ListText></Button>}
    ListFooterComponent={hasMore ? button('加载更多专辑', () => { void load(request.current.page + 1) }) : null}
  />
})
