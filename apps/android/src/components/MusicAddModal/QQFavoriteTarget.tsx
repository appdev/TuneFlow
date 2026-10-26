import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import SourceLogo from '@/components/SourceLogo'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useI18n, type Message } from '@/lang'
import { addQQFavoriteSong } from '@/core/musicAccount/qqFavorite'
import { syncQQFavorites } from '@/core/musicAccount/autoSync'
import type { QQFavoriteResult } from '@/types/qqFavorite'

export default ({ musicInfo, disabled, onBusy, onLogin }: {
  musicInfo: LX.Music.MusicInfo
  disabled: boolean
  onBusy: (busy: boolean) => void
  onLogin: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const [result, setResult] = useState<QQFavoriteResult>()
  const [working, setWorking] = useState(false)
  const [syncMessage, setSyncMessage] = useState<keyof Message>()
  const mounted = useRef(true)
  const running = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const supported = musicInfo.source == 'tx' && /^[a-zA-Z0-9]{1,64}$/.test(String(musicInfo.meta.songId))
  const checking = result?.status == 'unknown' || result?.status == 'unconfirmed'
  const submit = async() => {
    if (running.current || disabled || !supported || result?.status == 'added') return
    if (result?.status == 'login_required') { onLogin(); return }
    running.current = true
    setWorking(true)
    onBusy(true)
    try {
      const next = await addQQFavoriteSong({ songMid: String(musicInfo.meta.songId), action: checking ? 'check' : 'add' })
      if (mounted.current) setResult(checking && next.status == 'unavailable' ? { ...next, status: 'unknown' } : next)
      if (next.status == 'added' && next.owner && next.accountId) {
        if (mounted.current) setSyncMessage('list_sync_favorite_pending')
        void syncQQFavorites(next.owner, next.accountId).then(sync => {
          if (mounted.current) setSyncMessage(sync.failed ? 'list_sync_favorite_failed' : sync.total ? 'list_sync_favorite_done' : 'list_sync_favorite_unlinked')
        }).catch(() => { if (mounted.current) setSyncMessage('list_sync_favorite_failed') })
      }
    } catch { if (mounted.current) setResult({ status: 'unknown' }) } finally {
      running.current = false
      if (mounted.current) { setWorking(false); onBusy(false) }
    }
  }
  return <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: theme['q-surface-tint'], gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <SourceLogo source="tx" size={26} />
      <Text size={13} style={{ flex: 1, minWidth: 100 }}>{t('qq_favorite_title')}</Text>
      <Button disabled={disabled || working || !supported || result?.status == 'added'} onPress={() => { void submit() }} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme['q-surface-raised'] }}>
        {working ? <ActivityIndicator color={theme['q-accent-text']} /> : <Text size={12} color={theme['q-accent-text']}>{t(result?.status == 'added' ? 'qq_favorite_added_button' : result?.status == 'login_required' ? 'qq_favorite_login' : checking ? 'qq_favorite_check' : 'qq_favorite_add')}</Text>}
      </Button>
    </View>
    {!supported ? <Text size={11} color={theme['q-text-secondary']}>{t('qq_favorite_supported')}</Text> : null}
    {result ? <Text size={12} accessibilityLiveRegion="polite" style={{ lineHeight: 18 }} color={theme['q-text-secondary']}>{t(`qq_favorite_${result.status}`)}{result.code != null ? ` ${t('qq_favorite_error_code', { code: result.code })}` : ''}</Text> : null}
    {syncMessage ? <Text size={11} accessibilityLiveRegion="polite" style={{ lineHeight: 17 }} color={theme['q-text-secondary']}>{t(syncMessage)}</Text> : null}
  </View>
}
