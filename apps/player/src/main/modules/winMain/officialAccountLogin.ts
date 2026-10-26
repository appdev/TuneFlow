import { BrowserWindow, type Session, type WebContents } from 'electron'
import { fitAccountLoginWindow, getAccountLoginBounds } from './accountLoginLayout'

type Provider = 'tx' | 'wy'
const logins = new Map<Provider, { window: BrowserWindow, task: Promise<'connected' | 'cancelled'> }>()
export const closeOfficialAccountLogin = (provider: Provider) => { logins.get(provider)?.window.close() }

export const openOfficialAccountLogin = async(provider: Provider, options: {
  title: string
  url: string
  session: Session
  configureProxy: () => Promise<unknown>
  verify: () => Promise<boolean>
  configureContents: (contents: WebContents, onChildWindow: (window: BrowserWindow) => void) => void
}): Promise<'connected' | 'cancelled'> => {
  const existing = logins.get(provider)
  if (existing && !existing.window.isDestroyed()) { existing.window.show(); existing.window.focus(); return existing.task }
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const window = new BrowserWindow({
    ...getAccountLoginBounds(parent),
    parent,
    modal: !!parent,
    show: false,
    autoHideMenuBar: true,
    title: options.title,
    backgroundColor: '#f7faf8',
    webPreferences: { session: options.session, nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false },
  })
  let resolveTask: (status: 'connected' | 'cancelled') => void
  const task = new Promise<'connected' | 'cancelled'>(resolve => { resolveTask = resolve })
  logins.set(provider, { window, task })
  let settled = false
  let checking = false
  const children = new Set<BrowserWindow>()
  const finish = (status: 'connected' | 'cancelled') => {
    if (settled) return
    settled = true
    clearInterval(timer)
    options.session.cookies.off('changed', check)
    logins.delete(provider)
    resolveTask(status)
    for (const child of children) { if (!child.isDestroyed()) child.close() }
    if (!window.isDestroyed()) window.close()
  }
  const check = () => {
    if (settled || checking) return
    checking = true
    // 官方 iframe 内写 Cookie 不一定引发顶层导航，保留 Cookie 事件和定时核验。
    void options.verify().then(connected => { if (!settled && connected) finish('connected') }).catch(() => {}).finally(() => { checking = false })
  }
  const timer = setInterval(check, 1500)
  options.configureContents(window.webContents, child => {
    children.add(child)
    child.once('closed', () => { children.delete(child) })
  })
  fitAccountLoginWindow(window, options.url)
  options.session.cookies.on('changed', check)
  window.once('closed', () => { finish('cancelled') })
  window.once('ready-to-show', () => { if (!settled) { window.show(); window.focus() } })
  const page = (failed: boolean) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${options.title}</title><style>body{margin:0;background:#f7faf8;color:#23302e;font:15px "Microsoft YaHei",sans-serif;display:grid;place-content:center;min-height:100vh;text-align:center}a{color:#247554}</style><h2>${failed ? '登录页面暂时无法加载' : '正在打开官方登录页面…'}</h2><p>${failed ? '请检查网络后重试，也可以关闭此窗口。' : '请稍候，窗口可以随时关闭。'}</p>${failed ? `<a href="${options.url}">重新加载</a>` : ''}</html>`)}`
  // 先显示本地加载页，网络初始化不阻塞窗口出现。
  void window.loadURL(page(false)).then(async() => {
    await options.configureProxy()
    if (!settled) await window.loadURL(options.url)
  }).catch(async() => { if (!settled) await window.loadURL(page(true)).catch(() => {}) })
  return task
}
