import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { getWorkspace, notifyAccountsChanged, subscribeAccounts } from '@/service/session'
import { sharedAccounts } from '@/service/accounts'
import { ServiceError } from '@/service/client'

export default ({ onChange }: { onChange: (authorized: boolean) => void }) => {
  const theme = useTheme()
  const [authorized, setAuthorized] = useState(false); const [configured, setConfigured] = useState(false); const [editing, setEditing] = useState(false)
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const mounted = useRef(true); const running = useRef(false); const generation = useRef(0); const unlocked = useRef(false)
  const clear = useCallback(() => { setPassword(''); setConfirmation(''); setCurrentPassword('') }, [])
  const load = useCallback(async() => {
    const version = ++generation.current; const workspace = getWorkspace(); const api = sharedAccounts(workspace.client)
    let access: { passwordConfigured: boolean }; let next = true
    try { access = await api.device() } catch (reason) { if (!(reason instanceof ServiceError) || reason.code !== 'DEVICE_AUTH_REQUIRED') throw reason; next = false; access = await api.accessStatus() }
    if (!mounted.current || version !== generation.current || workspace !== getWorkspace()) return
    if (unlocked.current !== next) { clear(); setEditing(false) }
    unlocked.current = next; setAuthorized(next); setConfigured(access.passwordConfigured); setLoading(false); onChange(next)
  }, [onChange, clear])
  useEffect(() => {
    mounted.current = true
    const refresh = () => { if (running.current) return; void load().catch(reason => { if (mounted.current) { setLoading(false); setError(reason instanceof Error ? reason.message : '暂时无法检查访问状态') } }) }
    refresh(); const unsubscribe = subscribeAccounts(refresh)
    return () => { mounted.current = false; generation.current++; unsubscribe() }
  }, [load])
  const run = async(action: () => Promise<void>) => {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '访问失败，请重试') } finally { running.current = false; if (mounted.current) { clear(); setBusy(false) } }
  }
  const signIn = () => { void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).signIn(password, 'Android'); if (!mounted.current || workspace !== getWorkspace()) return; await load(); notifyAccountsChanged() }) }
  const savePassword = () => {
    if (password !== confirmation) { setError('两次输入的密码不一致'); return }
    void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).setPassword(password, configured ? currentPassword : undefined); if (!mounted.current || workspace !== getWorkspace()) return; setEditing(false); await load(); notifyAccountsChanged(); setMessage('访问密码已保存，其他应用可输入此密码解锁') })
  }
  const signOut = () => { void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).signOut(); if (!mounted.current || workspace !== getWorkspace()) return; await load(); notifyAccountsChanged() }) }
  const action = (title: string, onPress: () => void, disabled = false) => <Button disabled={busy || disabled} style={[styles.button, { backgroundColor: theme['q-surface-tint'] }]} onPress={onPress}><Text size={13} color={theme['q-accent-text']}>{title}</Text></Button>
  const field = (label: string, value: string, setValue: (value: string) => void, isNew = false) => <View style={styles.field}><Text size={12}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={setValue} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={isNew ? 'new-password' : 'current-password'} maxLength={128} editable={!busy} style={[styles.input, { color: theme['c-font'], borderColor: theme['q-outline'] }]} /></View>
  return <View style={[styles.card, { backgroundColor: theme['q-surface-tint'], borderColor: theme['q-outline'] }]}>
    <Text size={16}>{authorized ? '共享账号已解锁' : '解锁共享账号'}</Text>
    <Text size={12} color={theme['q-text-secondary']}>{authorized ? '此应用会记住访问授权，平台账号在各端共享。' : '输入访问密码即可使用已有的平台账号，无需重复扫码。'}</Text>
    {loading ? <Text size={12}>正在检查访问状态…</Text> : !authorized ? configured ? <>{field('访问密码', password, setPassword)}{action(busy ? '正在解锁…' : '解锁并记住', signIn, !password)}</> : <Text size={12}>尚未设置访问密码。首次使用请由服务管理员设置 TUNEFLOW_ACCESS_PASSWORD 环境变量并启动服务（8～128 个字符），或在已登录的应用中设置。</Text> : <>
      {configured ? <View style={styles.row}>{action(editing ? '取消修改' : '修改访问密码', () => { clear(); setEditing(!editing) })}{action('退出当前访问', signOut)}</View> : null}
      {!configured || editing ? <>
        <Text size={12}>{configured ? '修改后，其他应用需要输入新密码；当前访问和平台登录会保留。' : '设置一个各端共用的访问密码，现有登录和音乐数据会保留。'}</Text>
        {configured ? field('当前密码', currentPassword, setCurrentPassword) : null}
        {field(configured ? '新密码' : '访问密码', password, setPassword, true)}
        {field('确认密码', confirmation, setConfirmation, true)}
        {action(busy ? '正在保存…' : '保存访问密码', savePassword, password.length < 8 || !confirmation)}
      </> : null}
    </>}
    {message ? <Text size={12} accessibilityLiveRegion="polite">{message}</Text> : null}
    {error ? <Text size={12} accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>
}
const styles = StyleSheet.create({ card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, field: { gap: 6 }, button: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8 }, input: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 10 } })
