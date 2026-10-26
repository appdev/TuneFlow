import { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Image, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { kugouApi, saveKugouSession } from '@/core/musicAccount/kugou'
import type { KugouQr } from '@/core/musicAccount/kugouApi'

export default ({ onConnected }: { onConnected: () => void }) => {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const [revision, setRevision] = useState(0)
  const [qr, setQr] = useState<KugouQr>()
  const [message, setMessage] = useState('正在获取二维码…')
  const [loading, setLoading] = useState(true)
  const size = Math.min(260, Math.max(160, width - 80))

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const start = async() => {
      setLoading(true)
      setQr(undefined)
      setMessage('正在获取二维码…')
      let code: KugouQr
      try {
        code = await kugouApi.createQr(controller.signal)
      } catch {
        if (active) { setLoading(false); setMessage('二维码加载失败，请刷新重试') }
        return
      }
      if (!active) return
      setQr(code)
      setLoading(false)
      setMessage('使用酷狗音乐 App 扫码')
      const poll = async() => {
        if (!active) return
        if (Date.now() >= code.expiresAt) { setMessage('二维码已过期，请刷新'); return }
        if (AppState.currentState != 'active') { timer = setTimeout(() => { void poll() }, 2000); return }
        try {
          const result = await kugouApi.checkQr(code, controller.signal)
          if (!active) return
          if (result.status == 'expired') { setMessage('二维码已过期，请刷新'); return }
          if (result.session) {
            try { await saveKugouSession(result.session) } catch {
              if (active) setMessage('凭证保存失败，请确认已安装最新版后重试')
              return
            }
            if (active) { setMessage('登录成功'); onConnected() }
            return
          }
          setMessage(result.status == 'scanned' ? '已扫码，请在酷狗音乐中确认授权' : '等待扫码…')
        } catch {
          if (!active) return
          setMessage('连接暂时失败，正在重试')
        }
        if (active) timer = setTimeout(() => { void poll() }, 2000)
      }
      void poll()
    }
    void start()
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [revision, onConnected])

  return <ScrollView contentContainerStyle={styles.container}>
    <Text size={20} style={styles.title}>酷狗音乐登录</Text>
    <Text size={13} color={theme['q-text-secondary']} style={styles.tip}>登录后可选择自己的歌单导入 TuneFlow</Text>
    <View style={[styles.code, { width: size, height: size }]}>
      {qr ? <Image source={{ uri: qr.image }} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="酷狗音乐登录二维码" /> : <ActivityIndicator color={theme['q-accent']} />}
    </View>
    <Text size={14} accessibilityLiveRegion="polite" style={styles.tip}>{message}</Text>
    <Button disabled={loading} onPress={() => { setRevision(value => value + 1) }} style={[styles.refresh, { backgroundColor: theme['q-surface-tint'] }]}>
      <Text color={theme['q-accent-text']}>刷新二维码</Text>
    </Button>
    <Text size={12} color={theme['q-text-secondary']} style={styles.tip}>同一手机可先截图，再使用酷狗扫一扫的相册识别。</Text>
  </ScrollView>
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 24 },
  title: { fontWeight: '600', marginBottom: 8 },
  tip: { textAlign: 'center', lineHeight: 21, marginVertical: 10 },
  code: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginVertical: 10 },
  refresh: { borderRadius: 12, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
})
