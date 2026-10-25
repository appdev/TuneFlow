import { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useDockInset } from '@/components/common/DockInset'
import { setNavActiveId } from '@/core/common'
import { setActiveList } from '@/core/list'
import { getWorkspace } from './session'
import { LIBRARY_ID } from './workspace'
import { type DownloadDto } from './client'

const labels = { waiting: '排队中', running: '下载中', paused: '已暂停', error: '失败', completed: '已完成' }
export default () => {
  const theme = useTheme()
  const dockInset = useDockInset()
  const [tasks, setTasks] = useState<DownloadDto[]>([])
  const [error, setError] = useState('')
  const active = useRef(true)
  const busy = useRef(false)
  const load = async() => { const tasks = await getWorkspace().client.downloads(); if (active.current) setTasks(tasks) }
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
  const button = (label: string, onPress: () => void) => <Button accessibilityLabel={label} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}><Text size={13}>{label}</Text></Button>
  return <FlatList data={tasks} keyExtractor={item => item.id} contentContainerStyle={{ padding: 16, paddingBottom: 24 + dockInset }}
    ListHeaderComponent={<View style={{ gap: 10 }}><Text size={18}>下载</Text><Text size={12}>下载完成后可在音乐库播放；移除任务记录会保留已下载文件。</Text>
      {button('刷新任务', () => { void run(load) })}
      {button('下载设置', () => { global.lx.settingActiveId = 'downloads'; setNavActiveId('nav_setting') })}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>}
    ListEmptyComponent={<Text>暂无下载任务</Text>}
    renderItem={({ item }) => <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: theme['q-outline'] }}>
      <Text>{item.musicInfo.name} · {item.musicInfo.singer}</Text><Text size={12}>{labels[item.status]} · {Math.round(item.progress)}% · {item.quality}</Text>
      {item.error ? <Text size={12}>{item.error}</Text> : null}
      {['running', 'waiting'].includes(item.status) ? button('暂停', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'pause'); await load() }) }) : item.status !== 'completed' ? button('继续 / 重试', () => { void run(async() => { await getWorkspace().client.downloadAction(item.id, 'resume'); await load() }) }) : button('打开音乐库', () => { setActiveList(LIBRARY_ID); setNavActiveId('nav_love') })}
      {button('移除任务记录', () => { Alert.alert('移除下载记录？', '已完成的音乐文件会保留。', [{ text: '取消', style: 'cancel' }, { text: '移除', onPress: () => { void run(async() => { await getWorkspace().client.deleteDownload(item.id); await load() }) } }]) })}
    </View>}
  />
}
