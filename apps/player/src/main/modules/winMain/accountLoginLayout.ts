import { screen, type BrowserWindow } from 'electron'

// Electron 尺寸是 DIP，按父窗口所在显示器的工作区约束，兼容 Windows 缩放和小屏幕。
export const getAccountLoginBounds = (parent?: BrowserWindow, popup = false) => {
  const { workArea } = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay()
  const width = Math.max(320, Math.min(popup ? 760 : 1100, workArea.width - 48))
  const height = Math.max(320, Math.min(popup ? 660 : 800, workArea.height - 64))
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(560, width),
    minHeight: Math.min(460, height),
    resizable: true,
  }
}

export const getAccountLoginZoom = (url: string, width: number, height: number) => {
  let host: string
  try { host = new URL(url).hostname } catch { return 1 }
  // 官方桌面网站使用固定最小宽度，原来的窄窗会把登录弹层裁掉。
  // 保留网页自身布局和滚动，通过视口缩放让弹层及底部按钮完整可见。
  const size = host == 'music.163.com' || host == 'y.qq.com' ? [1100, 760]
    : host == 'graph.qq.com' || host.endsWith('.ptlogin2.qq.com') ? [720, 540]
      : host == 'open.weixin.qq.com' ? [420, 560] : null
  return size ? Math.max(0.25, Math.min(1, width / size[0], height / size[1])) : 1
}

export const fitAccountLoginWindow = (window: BrowserWindow, initialUrl: string) => {
  const fit = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    const [width, height] = window.getContentSize()
    window.webContents.setZoomFactor(getAccountLoginZoom(window.webContents.getURL() || initialUrl, width, height))
  }
  window.on('resize', fit)
  window.webContents.on('dom-ready', fit)
  window.webContents.on('did-navigate', fit)
  fit()
}
