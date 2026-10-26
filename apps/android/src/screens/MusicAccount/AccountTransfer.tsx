import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View, PermissionsAndroid, Platform, Keyboard } from 'react-native'
import Feather from 'react-native-vector-icons/Feather'
import Clipboard from '@react-native-clipboard/clipboard'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import { useTheme } from '@/store/theme/hook'
import { getProviderCookies } from '@/core/musicAccount/cookies'
import { receiveAccountTransfer, saveAccountTransfer, scanAccountTransfer, type TransferCandidate } from '@/core/musicAccount/accountTransfer'

const messageFor = (error: any) => {
  const code = error?.code || error?.message
  if (code == 'transfer_network') return '连接不到电脑。请确认在同一 Wi-Fi，电脑仍显示配对码，且防火墙允许连接。'
  if (code == 'transfer_expired') return '配对码已过期或已使用，请在电脑重新生成。'
  if (code == 'login_required') return '电脑的账号登录已失效，请重新登录后生成配对码。'
  if (code == 'credential_storage') return '无法保存账号，请重试。原来的登录状态未被替换。'
  if (code == 'account_changed') return '当前账号已发生变化，请关闭后重新导入。'
  if (code == 'transfer_cancelled') return '已取消连接。'
  return '无法验证配对或账号，请在电脑重新生成后重试。'
}
export default ({ onConnected }: { onConnected: () => void }) => {
  const theme = useTheme()
  const [code, setCode] = useState('')
  const [candidate, setCandidate] = useState<TransferCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pasteVisible, setPasteVisible] = useState(false)
  const [message, setMessage] = useState('')
  const active = useRef(true)
  const controller = useRef<AbortController>()
  const previous = useRef<Record<string, string>>({})
  const receiving = useRef(false)
  const scanPending = useRef(false)
  useEffect(() => () => { active.current = false; controller.current?.abort() }, [])
  const receive = async(value: string) => {
    if (receiving.current || !active.current) return
    if (!value.trim().startsWith('qmusic://account-transfer?')) { setMessage('这不是 Q-music 配对码，请扫描电脑「连接手机」里的二维码。'); return }
    receiving.current = true
    Keyboard.dismiss()
    setBusy(true)
    setMessage('正在连接电脑并验证 QQ 音乐账号…')
    const abort = new AbortController()
    controller.current = abort
    try {
      previous.current = await getProviderCookies('tx')
      if (!active.current || abort.signal.aborted) return
      const result = await receiveAccountTransfer(value, abort.signal)
      if (active.current) { setCandidate(result); setCode(''); setMessage('请确认这是要在本机使用的账号。导入不会自动覆盖本地歌单。') }
    } catch (error) { if (active.current) setMessage(messageFor(error)) } finally { receiving.current = false; if (active.current) setBusy(false) }
  }
  const scan = async() => {
    if (scanPending.current || receiving.current) return
    scanPending.current = true
    setScanning(true)
    setMessage('')
    Keyboard.dismiss()
    try {
      if (Platform.OS == 'android') {
        const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
        if (permission != PermissionsAndroid.RESULTS.GRANTED) { if (active.current) setMessage('未获得相机权限，也可以粘贴电脑上的配对码。'); return }
      }
      if (!active.current) return
      const value = await scanAccountTransfer()
      if (value && active.current) { setCode(value); await receive(value) }
    } catch { if (active.current) setMessage('暂时无法打开相机，请粘贴配对码。') } finally { scanPending.current = false; if (active.current) setScanning(false) }
  }
  const save = async() => {
    if (!candidate || saving) return
    setSaving(true)
    try {
      await saveAccountTransfer(candidate, previous.current)
      if (active.current) { setCandidate(null); onConnected() }
    } catch (error) { if (active.current) setMessage(messageFor(error)) } finally { if (active.current) setSaving(false) }
  }
  const disabled = busy || scanning || saving
  const paste = async() => {
    try {
      const value = await Clipboard.getString()
      if (active.current) { setCode(value.slice(0, 1024)); setMessage(value.trim() ? '' : '剪贴板里没有配对码，请先在电脑复制。') }
    } catch { if (active.current) setMessage('无法读取剪贴板，可以手动粘贴。') }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: theme['c-content-background'] }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
    <View style={styles.content}>
      <View style={[styles.hero, { backgroundColor: theme['q-surface-tint'] }]}>
        <View style={styles.devices} accessible={false}>
          <Feather name={candidate ? 'check-circle' : 'monitor'} size={32} color={theme['q-accent-text']} />
          {!candidate && <><Feather name="arrow-right" size={18} color={theme['q-accent-text']} /><Feather name="smartphone" size={28} color={theme['q-accent-text']} /></>}
        </View>
        <Text size={20} style={styles.title}>{candidate ? '确认你的音乐账号' : '用电脑连接微信账号'}</Text>
        <Text size={12} style={styles.centered} color={theme['q-text-secondary']}>{candidate ? '验证已完成，确认后在这台设备使用' : '在电脑完成微信授权，再安全连接到手机'}</Text>
      </View>
      {candidate ? <View style={[styles.identity, { borderColor: theme['q-outline'] }]}>
        <Text size={18} style={styles.title}>{candidate.name}</Text><Text size={13} color={theme['q-text-secondary']}>{candidate.hint}</Text>
      </View> : <>
        <View style={styles.steps}>
          {['电脑和手机连接同一 Wi-Fi', '电脑 Q-music → QQ 音乐，用微信登录', '在电脑点击「连接手机」，显示配对码'].map((label, index) => <View key={label} style={styles.step}>
            <View style={[styles.number, { backgroundColor: theme['q-surface-tint'] }]}><Text size={11} color={theme['q-accent-text']}>{index + 1}</Text></View>
            <Text size={13} style={styles.stepText} color={theme['q-text-secondary']}>{label}</Text>
          </View>)}
        </View>
        <Button disabled={disabled} style={[styles.primary, { backgroundColor: theme['q-accent'] }]} onPress={() => { void scan() }}>
          {busy || scanning ? <ActivityIndicator color={theme['q-on-accent']} /> : <Feather name="maximize" size={20} color={theme['q-on-accent']} />}
          <Text size={14} color={theme['q-on-accent']}>{busy ? '正在验证账号…' : scanning ? '正在打开相机…' : '扫描电脑配对码'}</Text>
        </Button>
        <Button disabled={disabled} style={styles.secondary} onPress={() => { setPasteVisible(value => !value) }}>
          <Feather name="clipboard" size={16} color={theme['q-accent-text']} /><Text size={13} color={theme['q-accent-text']}>{pasteVisible ? '收起配对码输入' : '改用配对码连接'}</Text>
        </Button>
        {pasteVisible && <View style={[styles.pasteCard, { borderColor: theme['q-outline'] }]}>
          <Text size={12} color={theme['q-text-secondary']}>在电脑复制配对码，通过你自己的设备传到手机后粘贴。</Text>
          <Input value={code} onChangeText={setCode} editable={!disabled} placeholder="粘贴 Q-music 配对码" accessibilityLabel="配对码" autoCorrect={false} autoCapitalize="none" maxLength={1024} secureTextEntry containerStyle={{ flexGrow: 0 }} />
          <View style={styles.actions}><Button disabled={disabled} style={styles.button} onPress={() => { void paste() }}><Text size={13}>粘贴</Text></Button><Button disabled={disabled || !code.trim()} style={[styles.button, { backgroundColor: theme['q-surface-tint'] }]} onPress={() => { void receive(code) }}><Text size={13} color={theme['q-accent-text']}>连接电脑</Text></Button></View>
        </View>}
      </>}
      {!!message && <View style={[styles.notice, { backgroundColor: theme['q-surface-tint'] }]}><Text size={12} accessibilityLiveRegion="polite" style={styles.noticeText} color={theme['q-text-secondary']}>{message}</Text></View>}
      {busy ? <Button style={styles.secondary} onPress={() => { controller.current?.abort() }}><Text size={13} color={theme['q-accent-text']}>取消连接</Text></Button> : null}
      {candidate ? <>
        <Button disabled={saving} style={[styles.primary, { backgroundColor: theme['q-accent'] }]} onPress={() => { void save() }}>{saving && <ActivityIndicator color={theme['q-on-accent']} />}<Text color={theme['q-on-accent']}>{saving ? '正在保存…' : '确认使用此账号'}</Text></Button>
        <Button disabled={saving} style={styles.secondary} onPress={() => { setCandidate(null); setMessage('请在电脑切换账号并重新生成配对码。') }}><Text size={13} color={theme['q-accent-text']}>不是这个账号，重新连接</Text></Button>
      </> : <Text size={11} color={theme['q-text-secondary']} style={styles.centered}>配对码 3 分钟内有效 · 仅在确认后保存账号</Text>}
    </View>
  </ScrollView>
}
const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, alignItems: 'center' },
  content: { width: '100%', maxWidth: 520, gap: 12 },
  hero: { borderRadius: 22, padding: 22, alignItems: 'center', gap: 12 },
  devices: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingBottom: 4 },
  title: { fontWeight: '600', textAlign: 'center' },
  centered: { textAlign: 'center', lineHeight: 19 },
  steps: { gap: 14, paddingVertical: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepText: { flex: 1, lineHeight: 20 },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 52, padding: 12, borderRadius: 16, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  pasteCard: { padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 12 },
  identity: { padding: 22, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 8, alignItems: 'center' },
  notice: { padding: 14, borderRadius: 14 },
  noticeText: { lineHeight: 20 },
})
