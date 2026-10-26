import { memo, useEffect, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import commonState from '@/store/common/state'
import { pushMusicAccountScreen } from '@/navigation/navigation'
import { getSharedAccountStatus } from '@/service/accounts'
import { subscribeAccounts } from '@/service/session'
import { ServiceError } from '@/service/client'

const MusicAccountEntry = memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = () => { void getSharedAccountStatus().then(status => { if (active) { setConnected(status.tx || status.wy || status.kg); setLocked(false) } }).catch(reason => { if (active) { setConnected(false); setLocked(reason instanceof ServiceError && reason.code === 'DEVICE_AUTH_REQUIRED') } }) }
    refresh()
    const unsubscribe = subscribeAccounts(refresh)
    return () => { active = false; unsubscribe() }
  }, [])

  return (
    <View style={styles.content}>
      <Text size={13}>各端输入访问密码后，即可共享平台账号、歌单与个人推荐。导入保留已有内容。</Text>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.6}
        onPress={() => {
          if (commonState.componentIds.home) pushMusicAccountScreen(commonState.componentIds.home)
        }}
      >
        <View style={styles.labelWrap}>
          <Text style={styles.label}>{t('setting_music_account_title')}</Text>
          <Text size={11} color={theme['q-text-secondary']}>
            {locked ? '输入访问密码以查看' : connected == null ? '' : connected ? t('setting_music_account_connected') : t('setting_music_account_disconnected')}
          </Text>
        </View>
        <Text size={14} color={theme['q-text-secondary']}>{'›'}</Text>
      </TouchableOpacity>
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    paddingHorizontal: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  labelWrap: {
    flexShrink: 1,
  },
  label: {
    fontSize: 14,
  },
})

export default MusicAccountEntry
