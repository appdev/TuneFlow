import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, Image, Linking, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { getWorkspace, notifyAccountsChanged, refreshServiceLists, subscribeAccounts } from '@/service/session'
import { sharedAccounts, publishMobileAccount, accountNames } from '@/service/accounts'
import { setDailyProvider } from '@/core/musicAccount/daily'
import { playFromPage } from '@/core/player/selection'
import { ServiceError } from '@/service/client'
import type { AccountProvider, AccountStatus, AccountPlaylist, AccountLogin } from '../../../../../packages/service-client/src/accounts'
import PasswordAccess from './PasswordAccess'
import { pollAccountLogin } from '../../../../../packages/service-client/src/accountLogin'

export default ({ initialProvider = 'tx', onBack, onNative }: { initialProvider?: AccountProvider, onBack: () => void, onNative: (provider: AccountProvider) => void }) => {
  const theme = useTheme(); const inset = useStatusbarHeight()
  const [provider, setProvider] = useState<AccountProvider>(initialProvider)
  const [authorized, setAuthorized] = useState(false)
  const [status, setStatus] = useState<AccountStatus>()
  const [lists, setLists] = useState<AccountPlaylist[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [dailyKey, setDailyKey] = useState('')
  const [flow, setFlow] = useState<AccountLogin>()
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const mounted = useRef(true); const version = useRef(0); const running = useRef(false)
  const api = () => sharedAccounts(getWorkspace().client)
  const run = async(action: () => Promise<void>) => {
    if (running.current) return; running.current = true; setBusy(true); setError('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '账号操作失败') } finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  const load = useCallback(async() => {
    const generation = ++version.current; const workspace = getWorkspace(); const client = sharedAccounts(workspace.client)
    const next = await client.status()
    const result = next[provider] ? await client.playlists(provider) : undefined
    if (!mounted.current || workspace !== getWorkspace() || generation !== version.current) return
    setStatus(next); setLists(result?.playlists ?? []); setSelected(new Set())
    if (result && result.status !== 'available') setError('账号歌单暂不可用，请刷新或重新授权')
  }, [provider])
  useEffect(() => {
    mounted.current = true; setLists([]); setFlow(undefined)
    if (authorized) void load().catch(reason => { if (mounted.current && !(reason instanceof ServiceError && reason.code === 'DEVICE_AUTH_REQUIRED')) setError(reason instanceof Error ? reason.message : '账号加载失败') })
    else { setStatus(undefined); setSelected(new Set()); setMessage(''); setError('') }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true })
    const unsubscribe = subscribeAccounts(() => { if (authorized && !running.current) void load().catch(reason => { if (mounted.current) { setStatus(undefined); setLists([]); if (reason instanceof ServiceError && reason.code === 'DEVICE_AUTH_REQUIRED') { setAuthorized(false); setFlow(undefined) } } }) })
    const invalidate = () => { version.current++ }
    return () => { mounted.current = false; invalidate(); subscription.remove(); unsubscribe() }
  }, [load, onBack, authorized])
  useEffect(() => {
    if (!flow) return
    const workspace = getWorkspace(); const client = sharedAccounts(workspace.client)
    const stopPolling = pollAccountLogin({
      expiresAt: flow.expiresAt,
      active: () => mounted.current && workspace === getWorkspace(),
      poll: async() => client.poll(flow.id),
      status: status => {
        setError('')
        if (status === 'connected') {
          setFlow(undefined); setMessage('已登录，各端解锁即可使用账号歌单和推荐'); notifyAccountsChanged()
          void load().catch(reason => { if (mounted.current && workspace === getWorkspace()) setError(reason instanceof Error ? reason.message : '账号加载失败') })
          return
        }
        if (status === 'expired') { setMessage('二维码已过期，请重新获取'); return }
        setMessage(status === 'scanned' ? '已扫码，请在官方应用确认' : '等待扫码')
      },
      error: (reason, retrying) => {
        setError(reason instanceof Error ? reason.message : '授权失败')
        setMessage(retrying ? '登录状态查询暂时失败，正在自动重试…' : '登录未完成，请重新扫码登录')
      },
    })
    return () => { stopPolling(); void client.cancel(flow.id).catch(() => {}) }
  }, [flow, load])
  const login = () => { void run(async() => { setFlow(undefined); const result = await api().login(provider); if (mounted.current) { setFlow(result); setMessage('请使用官方应用扫码并确认授权') } }) }
  const importSelected = () => {
    void run(async() => {
      if (!status) return
      const workspace = getWorkspace(); const client = sharedAccounts(workspace.client); let count = 0
      for (const id of selected) { if (workspace !== getWorkspace()) throw new Error('连接已变更'); count += (await client.import(provider, id, status.revisions[provider])).count }
      await refreshServiceLists(); setMessage(`已导入 ${count} 首歌曲，可在我的列表中查看`)
    })
  }
  const preview = (id: string) => {
    void run(async() => {
      if (!status) return
      const workspace = getWorkspace(); const result = await sharedAccounts(workspace.client).tracks(provider, id, status.revisions[provider])
      if (workspace !== getWorkspace()) throw new Error('连接已变更')
      if (!result.list.length) { setMessage('歌单暂无歌曲'); return }
      await playFromPage('account_preview', result.list.map(track => workspace.native(track)), 0)
    })
  }
  const action = (label: string, callback: () => void, disabled = false) => <Button disabled={busy || disabled} style={[styles.button, { backgroundColor: theme['q-surface-tint'] }]} onPress={callback}><Text size={13} color={theme['q-accent-text']}>{label}</Text></Button>
  return <ScrollView style={{ flex: 1, paddingTop: inset, backgroundColor: theme['c-content-background'] }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.row}>{action('返回', onBack)}<Text size={20}>音乐平台账号</Text></View>
    <Text size={13} color={theme['q-text-secondary']}>登录音乐平台，随时使用你的歌单与个人推荐。各端共享，导入保留已有内容。</Text>
    <PasswordAccess onChange={setAuthorized} />
    {authorized ? <>
      <View style={styles.row}>{(['tx', 'wy', 'kg'] as const).map(id => <View key={id}>{action(`${accountNames[id]}${status?.[id] ? ' · 已登录' : ''}`, () => { setProvider(id); setMore(false); setDailyKey(''); setError('') })}</View>)}</View>
      <View style={[styles.section, { backgroundColor: theme['q-surface-tint'] }]}>
      <Text size={16}>{accountNames[provider]}</Text><Text size={12} color={theme['q-text-secondary']}>{status?.[provider] ? '已登录 · 各端共享' : '使用官方应用扫码登录，已有歌单和音乐不会受到影响。'}</Text>
      <View style={styles.row}>{action(status?.[provider] ? '重新登录' : '扫码登录', login)}{action('刷新账号与歌单', () => { void run(load) })}</View>
      <View style={styles.row}>{action('设为推荐来源', () => { void run(async() => { await setDailyProvider(provider); await AsyncStorage.setItem('@qmusic_service_daily_mode', 'account'); notifyAccountsChanged(); setMessage('首页已使用此账号的个人推荐') }) }, !status?.[provider])}
      </View>
      {flow ? <View style={styles.section}><Image accessibilityLabel="官方登录二维码" source={{ uri: flow.image }} style={styles.qr} />{action('取消登录', () => { setFlow(undefined) })}</View> : null}
      {action(more ? '收起更多选项' : '更多选项', () => { setMore(!more) })}
      {more ? <View style={styles.section}><View style={styles.row}>{action('官方页面授权', () => { onNative(provider) })}{action('共享本机已登录账号', () => { void run(async() => { await publishMobileAccount(provider); await load(); notifyAccountsChanged() }) })}</View>
      {provider === 'tx' && status?.tx ? <View style={styles.section}><Text size={16}>QQ 官方日推授权</Text><Text size={12}>不设置时使用账号雷达推荐。专用授权码由 QQ 官方页面提供。</Text>
        {action('打开 QQ 官方授权页', () => { void Linking.openURL('https://y.qq.com/n/ryqq_v2/qqmusic_skills') })}
        <TextInput accessibilityLabel="专用授权码" value={dailyKey} onChangeText={setDailyKey} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={1100} style={[styles.input, { color: theme['c-font'], borderColor: theme['q-outline'] }]} />
        {action('保存并共享日推授权', () => { void run(async() => { await api().authorizeDaily(dailyKey.trim(), status.revisions.tx); setDailyKey(''); await load(); notifyAccountsChanged(); setMessage('QQ 官方日推授权已共享') }) }, !dailyKey)}
      </View> : null}
      {status?.[provider] ? <><Text size={12}>退出平台账号会同时影响各端；已导入的歌单和下载文件仍会保留。</Text>{action('退出此平台账号', () => { Alert.alert('退出平台账号', '各端将停止使用此平台账号，已导入的歌单和音乐文件会保留。', [{ text: '取消', style: 'cancel' }, { text: '退出', style: 'destructive', onPress: () => { void run(async() => { await api().logout(provider, status.revisions[provider]); await load(); notifyAccountsChanged(); setMessage('已退出平台账号，已导入的歌单和音乐文件保留') }) } }]) })}</> : null}
      </View> : null}
      </View>
      <Text size={16}>账号歌单</Text>
      {lists.length ? <View style={styles.row}>{action('全选', () => { setSelected(new Set(lists.map(item => item.id))) })}{action(`导入所选（${selected.size}）`, importSelected, !selected.size)}</View> : <Text size={12}>登录后查看创建和收藏的歌单。</Text>}
      {lists.map(item => <View style={[styles.section, { borderColor: theme['q-outline'], borderWidth: StyleSheet.hairlineWidth }]} key={item.id}>
        <Button accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(item.id) }} onPress={() => { setSelected(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next }) }}><Text size={14}>{selected.has(item.id) ? '☑ ' : '☐ '}{item.name} · {item.trackCount} 首</Text></Button>
        {action('播放歌单', () => { preview(item.id) })}
      </View>)}
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" size={13}>{message}</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" size={13} color={theme['q-text-secondary']}>{error}</Text> : null}
  </ScrollView>
}
const styles = StyleSheet.create({ content: { padding: 16, paddingBottom: 70, gap: 14 }, section: { padding: 14, borderRadius: 16, gap: 10 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14 }, input: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10 }, qr: { width: 256, height: 256, backgroundColor: '#fff', resizeMode: 'contain' } })
