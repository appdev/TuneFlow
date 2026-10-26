import { getProviderCookies, getQQCredentials } from '@/core/musicAccount/cookies'
import { requireKugouSession } from '@/core/musicAccount/kugou'
import { toMD5 } from '@/utils/musicSdk/utils'
import type { DailySource } from './recommendations'

// Read local authorization only. Never refresh a platform API just for navigation.
export const getDailyAccountKey = async(source: DailySource): Promise<string> => {
  if (source === 'server') return ''
  try {
    if (source === 'kg') {
      const account = await requireKugouSession()
      return toMD5(JSON.stringify([account.userId, account.token]))
    }
    const cookies = await getProviderCookies(source)
    const qq = source === 'tx' ? getQQCredentials(cookies) : undefined
    const value = qq ? (qq.authst ? JSON.stringify([qq.uin, qq.authst]) : '') : cookies.MUSIC_U
    return value ? toMD5(value) : 'anonymous'
  } catch { return 'anonymous' }
}
