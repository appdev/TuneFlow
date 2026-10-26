import { NativeModules } from 'react-native'
import { getProviderCookies } from './cookies'
import { getQQCredentials } from './qqCredentials'
import { parseQQImportedCookies, saveQQImportedCookies } from './qqImportedSession'
import { request, qqRequest, checkCode } from './requests'
import { clearOfficialUrlCache } from './cache'
import { clearDailyCache } from './daily'

export interface TransferCandidate {
  cookies: Record<string, string>
  name: string
  hint: string
  expiresAt: number
}
export const scanAccountTransfer = async(): Promise<string | null> => NativeModules.AccountTransferModule.scan()
export const cancelAccountTransfer = () => { NativeModules.AccountTransferModule?.cancel() }

export const receiveAccountTransfer = async(code: string, signal: AbortSignal): Promise<TransferCandidate> => {
  if (!code.trim().startsWith('qmusic://account-transfer?') || code.length > 1024) throw new Error('transfer_invalid')
  if (signal.aborted) throw new Error('transfer_cancelled')
  const cancel = () => { cancelAccountTransfer() }
  signal.addEventListener('abort', cancel)
  try {
    const raw: string = await NativeModules.AccountTransferModule.receive(code.trim())
    if (signal.aborted) throw new Error('transfer_cancelled')
    const payload = JSON.parse(raw)
    if (payload.v != 1 || payload.provider != 'tx' || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now() || payload.expiresAt > Date.now() + 300_000) throw new Error('transfer_expired')
    const cookies = parseQQImportedCookies(payload.cookies)
    const { uin, isWeChat } = getQQCredentials(cookies)
    const profile = await request(`https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?ct=20&cv=4747474&cid=205360838&userid=${uin}`, cookies, { headers: { Referer: 'https://y.qq.com/' } }, signal)
    checkCode(profile.code, 0)
    await qqRequest({ provider: 'tx', cookies }, { status: { module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin', param: { uin } } }, signal)
    if (signal.aborted) throw new Error('transfer_cancelled')
    return { cookies, expiresAt: payload.expiresAt, name: String(profile.data?.creator?.nick || profile.data?.creator?.nickname || 'QQ 音乐账号').slice(0, 80), hint: `${isWeChat ? '微信' : 'QQ'} · ••••${uin.slice(-4)}` }
  } finally { signal.removeEventListener('abort', cancel) }
}

export const saveAccountTransfer = async(candidate: TransferCandidate, previous: Record<string, string>) => {
  if (candidate.expiresAt < Date.now()) throw new Error('transfer_expired')
  const before = getQQCredentials(previous)
  const current = getQQCredentials(await getProviderCookies('tx'))
  if (before.uin != current.uin || before.authst != current.authst || before.tmeLoginType != current.tmeLoginType) throw new Error('account_changed')
  await saveQQImportedCookies(candidate.cookies)
  clearOfficialUrlCache()
  clearDailyCache()
}
