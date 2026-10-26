import type { WebContents } from 'electron'
import { navigationUrlWhiteList } from '@common/config'

const windowPolicies = new WeakMap<WebContents, (url: string) => boolean>()

// 仅为指定的官方账号窗口设置规则，不扩大主界面或其他窗口的导航权限。
export const setWindowNavigationPolicy = (contents: WebContents, allow: (url: string) => boolean) => {
  windowPolicies.set(contents, allow)
}

export const allowOfficialNavigation = (target: string, domains: readonly string[]) => {
  if (target == 'about:blank') return true
  try {
    const url = new URL(target)
    if (url.protocol != 'https:' || url.username || url.password || url.port) return false
    return domains.some(domain => url.hostname == domain || url.hostname.endsWith(`.${domain}`))
  } catch { return false }
}

export const installNavigationGuard = (contents: WebContents, development = false) => {
  contents.on('will-navigate', (event, target) => {
    const policy = windowPolicies.get(contents)
    const allowed = policy ? policy(target) : development || navigationUrlWhiteList.some(pattern => pattern.test(target))
    if (!allowed) event.preventDefault()
    // 授权回调 URL 带有临时 code，不输出原始导航地址。
  })
}
