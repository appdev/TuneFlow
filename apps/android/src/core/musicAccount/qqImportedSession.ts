import { NativeModules } from 'react-native'
import { getQQCredentials } from './qqCredentials'

const allowed = new Set(['qqmusic_key', 'musickey', 'qqmusic_uin', 'musicid', 'login_type', 'wxuin', 'uin'])
export const parseQQImportedCookies = (value: unknown): Record<string, string> => {
  if (!value || typeof value != 'object' || Array.isArray(value)) throw new Error('transfer_invalid')
  const cookies: Record<string, string> = {}
  for (const [name, content] of Object.entries(value)) {
    if (!allowed.has(name) || typeof content != 'string' || !content || content.length > 4096 || !/^[!-:<-~]+$/.test(content)) throw new Error('transfer_invalid')
    cookies[name] = content
  }
  const identity = getQQCredentials(cookies)
  if (!identity.uin || !identity.authst || !['1', '2'].includes(cookies.login_type) || cookies.qqmusic_uin != identity.uin || cookies.qqmusic_key != identity.authst) throw new Error('transfer_invalid')
  return cookies
}
export const getQQImportedCookies = async(): Promise<Record<string, string> | null> => {
  const raw: string | null = await NativeModules.MusicCredentialModule?.getQQAccount?.()
  return raw ? parseQQImportedCookies(JSON.parse(raw)) : null
}
export const saveQQImportedCookies = async(cookies: Record<string, string>) => {
  if (!NativeModules.MusicCredentialModule?.setQQAccount) throw new Error('credential_storage')
  await NativeModules.MusicCredentialModule.setQQAccount(JSON.stringify(parseQQImportedCookies(cookies)))
}
export const clearQQImportedCookies = async() => { await NativeModules.MusicCredentialModule?.clearQQAccount?.() }
