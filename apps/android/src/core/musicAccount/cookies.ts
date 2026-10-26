import { NativeModules } from 'react-native'
import type { MusicAccountProvider } from './types'
import { getQQCredentials } from './qqCredentials'
import { getQQImportedCookies, clearQQImportedCookies } from './qqImportedSession'
export { getQQCredentials } from './qqCredentials'

const { UtilsModule } = NativeModules

const COOKIE_URLS: Record<MusicAccountProvider, string[]> = {
  kg: [],
  tx: ['https://y.qq.com', 'https://u.y.qq.com'],
  wy: ['https://music.163.com'],
}

/** 从 "k1=v1; k2=v2" 形式的 cookie 字符串解析出键值对 */
const parseCookieString = (raw: string | null | undefined): Record<string, string> => {
  if (!raw) return {}
  const cookies: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex < 0) continue
    const name = pair.slice(0, eqIndex).trim()
    const value = pair.slice(eqIndex + 1).trim()
    if (name) cookies[name] = value
  }
  return cookies
}

export const getProviderCookies = async(provider: MusicAccountProvider): Promise<Record<string, string>> => {
  if (provider == 'tx') {
    const imported = await getQQImportedCookies()
    if (imported) return imported
  }
  const cookies: Record<string, string> = {}
  for (const url of COOKIE_URLS[provider]) {
    // Android WebView CookieManager 为全局存储，原生层读取，多个 URL 合并去重
    const raw: string | null = await UtilsModule.getWebCookie(url)
    Object.assign(cookies, parseCookieString(raw))
  }
  return cookies
}

export const buildCookieHeader = (cookies: Record<string, string>): string => {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ')
}

/** QQ 需要音乐账号与音乐凭证；仅有 QQ 通用 skey 不算音乐授权成功。 */
export const isQQLoginCookieValid = (cookies: Record<string, string>): boolean => {
  const { uin, authst } = getQQCredentials(cookies)
  return Boolean(uin && authst)
}

/** 网易：MUSIC_U 存在视为已登录 */
export const isNeteaseLoginCookieValid = (cookies: Record<string, string>): boolean => {
  return Boolean(cookies.MUSIC_U)
}

export const clearProviderCookies = async(provider: MusicAccountProvider) => {
  if (provider == 'tx') await clearQQImportedCookies()
  for (const url of COOKIE_URLS[provider]) {
    await UtilsModule.clearWebCookie(url)
  }
}
