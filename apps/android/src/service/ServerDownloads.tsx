import { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, StyleSheet, View } from 'react-native'
import Text from '@/components/common/Text'
import ListText from '@/components/common/ListText'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useDockInset } from '@/components/common/DockInset'
import { setNavActiveId } from '@/core/common'
import { setActiveList } from '@/core/list'
import { getWorkspace } from './session'
import { LIBRARY_ID } from './workspace'
import { type DownloadDto } from './client'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'

const labels = { waiting: '排队中', running: '下载中', paused: '已暂停', error: '失败', completed: '已完成' }
export default () => {
  const theme = useTheme()
  const { phone } = useAdaptiveLayout()
  const dockInset = useDockInset()
  const [tasks, setTasks] = useState<DownloadDto[]>([])
  const [phoneTab, setPhoneTab] = useState<'completed' | 'active'>('completed')
  const visibleTasks = phone ? tasks.filter(item => phoneTab === 'completed' ? item.status === 'completed' : item.status !== 'completed') : tasks
  const [error, setError] = useState('')
  const [width, setWidth] = useState(0)
  const [loading, setLoading] = useState(true)
  const showArtist = width >= 600
  const active = useRef(true)
  const busy = useRef(false)
  const load = async() => {
    try { const tasks = await getWorkspace().client.downloads(); if (active.current) setTasks(tasks) } finally { if (active.current) setLoading(false) }
  }
  const run = async(action: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true
    try { await action(); if (active.current) setError('') } catch (e) { if (active.current) setError(e instanceof Error ? e.message : '操作失败') } finally { busy.current = false }
  }
  useEffect(() => {
    active.current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = () => { void run(load).finally(() => { if (active.current) timer = setTimeout(poll, 2500) }) }
    poll()
    return () => { active.current = false; clearTimeout(timer) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const button = (label: string, onPress: () => void, accessibilityLabel = label, secondary = false) => <Button accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.button}><Text size={13} color={theme[secondary ? 'q-text-secondary' : 'q-accent-text']}>{label}</Text></Button>
  const openLibrary = () => {
    setActiveList(LIBRARY_ID)
    setNavActiveId('nav_love')
    if (phone) requestAnimationFrame(() => { global.app_event.changeLoveListVisible(false) })
  }
  return <View onLayout={event => { setWidth(event.nativeEvent.layout.width) }} style={[styles.page, phone && { paddingHorizontal: 20 }, { paddingBottom: dockInset + 12 }]}>
    <View style={[styles.table, phone && { borderWidth: 0, borderRadius: 0 }, { borderColor: theme['q-outline'], backgroundColor: theme['q-surface-base'] }]}>
    <View style={styles.toolbar}>
      <Text size={16} style={styles.heading}>下载</Text><Text size={12} color={theme['q-text-secondary']} style={styles.count}>共 {tasks.length} 个任务</Text>
      {button('刷新任务', () => { void run(load) })}
      {button('下载设置', () => { global.lx.settingActiveId = 'downloads'; setNavActiveId('nav_setting') })}
    </View>
    <Text size={12} color={theme['q-text-secondary']} style={styles.hint}>下载完成后可在音乐库播放；移除任务记录会保留已下载文件。</Text>
    {error ? <Text accessibilityRole="alert" style={styles.hint}>{error}</Text> : null}
      <View importantForAccessibility="no-hide-descendants" style={[styles.row, styles.header, phone && { display: 'none' }, { borderColor: theme['q-outline'] }]}>
        {showArtist ? <Text size={12} color={theme['q-text-secondary']} style={styles.index}>#</Text> : null}
        <Text size={12} color={theme['q-text-secondary']} style={styles.song}>歌曲名</Text>
        {showArtist ? <Text size={12} color={theme['q-text-secondary']} style={styles.artist}>艺术家</Text> : null}
        <Text size={12} color={theme['q-text-secondary']} style={styles.status}>下载状态</Text>
        <Text size={12} color={theme['q-text-secondary']} style={[styles.actions, showArtist && styles.wideActions, styles.actionHeading]}>操作</Text>
      </View>
      {phone ? <View style={{ flexDirection: 'row', gap: 24, marginBottom: 12 }}>{(['completed', 'active'] as const).map((id, index) => <Button key={id} accessibilityRole="tab" accessibilityState={{ selected: phoneTab === id }} accessibilityLabel={index === 0 ? '已下载' : '下载中'} onPress={() => { setPhoneTab(id) }} style={{ minHeight: 44, justifyContent: 'center', borderBottomWidth: phoneTab === id ? 2 : 0, borderBottomColor: theme['q-accent-text'] }}><Text size={14} color={theme[phoneTab === id ? 'q-text-primary' : 'q-text-secondary']}>{index === 0 ? '已下载' : '下载中'}</Text></Button>)}</View> : null}
      <FlatList data={visibleTasks} keyExtractor={item => item.id} style={styles.list} contentContainerStyle={!visibleTasks.length && styles.emptyList}
        ListEmptyComponent={<Text size={13} color={theme['q-text-secondary']} style={styles.empty}>{loading ? '正在加载任务…' : error ? '暂时无法加载任务，请刷新重试' : '暂无下载任务'}</Text>}
        renderItem={({ item, index }) => {
          const progress = Number.isFinite(item.progress) ? Math.max(0, Math.min(100, Math.round(item.progress))) : 0
          if (phone) return <View style={{ minHeight: 76, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme['q-outline'] }}>
            <View style={{ flex: 1, minWidth: 0 }}><ListText numberOfLines={1}>{item.musicInfo.name ?? '未知歌曲'}</ListText><Text size={12} numberOfLines={1} style={{ marginTop: 4 }} color={theme['q-text-secondary']}>{item.musicInfo.singer ?? '未知艺术家'} / {labels[item.status]}</Text>
              {item.status !== 'completed' ? <View accessibilityRole="progressbar" accessibilityLabel={`下载进度：${item.musicInfo.name}`} accessibilityValue={{ min: 0, max: 100, now: progress }} style={[styles.progress, { flex: 0, height: 3, marginTop: 8, backgroundColor: theme['q-outline'] }]}><View style={{ height: '100%', width: `${progress}%`, backgroundColor: theme['q-accent-text'] }} /></View> : null}
              {item.status === 'error' && item.error ? <Text size={11} numberOfLines={2} color={theme['q-text-secondary']}>{item.error}</Text> : null}
            </View>
            <View style={styles.actions}>
              {['running', 'waiting'].includes(item.status) ? button('暂停', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'pause'); await load() }) }) : item.status !== 'completed' ? button(item.status === 'error' ? '重试' : '继续', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'resume'); await load() }) }) : button('音乐库', openLibrary)}
              {button('移除', () => { Alert.alert('移除下载记录？', '已完成的音乐文件会保留。', [{ text: '取消', style: 'cancel' }, { text: '移除', onPress: () => { void run(async() => { await getWorkspace().client.deleteDownload(item.id); await load() }) } }]) }, `移除任务记录：${item.musicInfo.name}`, true)}
            </View>
          </View>
          return <View style={[styles.row, styles.task, { borderColor: item.status === 'running' ? theme['q-outline'] : 'transparent', borderBottomColor: theme['q-outline'], backgroundColor: item.status === 'running' ? theme['q-surface-tint'] : 'transparent' }]}>
            {showArtist ? <Text size={12} color={theme['q-text-secondary']} style={styles.index}>{index + 1}</Text> : null}
            <View style={styles.song}>
              <View style={styles.title}><ListText numberOfLines={1} style={styles.songName}>{item.musicInfo.name ?? '未知歌曲'}</ListText></View>
              {!showArtist ? <ListText secondary numberOfLines={1} style={styles.subtitle}>{item.musicInfo.singer ?? '未知艺术家'}</ListText> : null}
            </View>
            {showArtist ? <ListText secondary numberOfLines={1} style={styles.artist}>{item.musicInfo.singer ?? '—'}</ListText> : null}
            <View style={styles.status}>
              <View style={styles.statusLabel}><Text size={12} color={item.status === 'completed' ? theme['q-accent-text'] : theme['q-text-primary']}>{labels[item.status]}</Text><Text size={12} color={theme['q-text-secondary']}>{item.quality?.toUpperCase()}</Text></View>
              {item.status === 'error' && item.error ? <Text accessibilityLabel={item.error} size={12} numberOfLines={2} color={theme['q-text-secondary']}>{item.error}</Text> : item.status !== 'completed' ? <View style={styles.progressLine}>
                <View accessibilityRole="progressbar" accessibilityLabel={`下载进度：${item.musicInfo.name}`} accessibilityValue={{ min: 0, max: 100, now: progress }} style={[styles.progress, { backgroundColor: theme['q-outline'] }]}><View style={{ height: '100%', width: `${progress}%`, backgroundColor: theme['q-accent-text'] }} /></View>
                <Text size={12} color={theme['q-text-secondary']} style={styles.percentage}>{progress}%</Text>
              </View> : null}
            </View>
            <View style={[styles.actions, showArtist && styles.wideActions]}>
              {['running', 'waiting'].includes(item.status) ? button('暂停', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'pause'); await load() }) }) : item.status !== 'completed' ? button(item.status === 'error' ? '重试' : '继续', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'resume'); await load() }) }) : button('音乐库', openLibrary)}
              {button('移除', () => { Alert.alert('移除下载记录？', '已完成的音乐文件会保留。', [{ text: '取消', style: 'cancel' }, { text: '移除', onPress: () => { void run(async() => { await getWorkspace().client.deleteDownload(item.id); await load() }) } }]) }, `移除任务记录：${item.musicInfo.name}`, true)}
            </View>
          </View>
        }}
      />
    </View>
  </View>
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, paddingTop: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12, paddingTop: 4 },
  heading: { fontWeight: '600' },
  count: { marginLeft: 'auto', marginRight: 4 },
  hint: { marginTop: 4, marginBottom: 10, paddingHorizontal: 12 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, borderRadius: 8 },
  table: { flex: 1, minHeight: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8 },
  header: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 15 },
  list: { flex: 1 },
  task: { minHeight: 64, marginHorizontal: 6, marginVertical: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  index: { width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
  song: { flex: 2, minWidth: 0 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  songName: { flexShrink: 1, fontWeight: '400' },
  subtitle: { marginTop: 4 },
  artist: { flex: 1, minWidth: 0 },
  status: { width: 88 },
  statusLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  progress: { flex: 1, height: 3, borderRadius: 3, overflow: 'hidden' },
  percentage: { width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  actions: { width: 96, flexDirection: 'row', justifyContent: 'flex-end' },
  wideActions: { width: 112, flexDirection: 'row', justifyContent: 'flex-end' },
  actionHeading: { textAlign: 'right', paddingRight: 6 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', padding: 24 },
})
