export const accountNames = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐' }
export const notifyAccountsChanged = () => window.dispatchEvent(new Event('qmusic-accounts-changed'))
export const loadDesktopAccountDaily = async() => ({ list: [], status: 'login_required' })
export const loadDesktopAccountPlaylist = async() => []
export const importDesktopAccountPlaylist = async() => { throw new Error('请在桌面端或 Android 导入账号歌单；导入后 Web 自动共享。') }
