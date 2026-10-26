import { autoUpdater } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import { log, isWin } from '@common/utils'
import { mainOn } from '@common/mainIpc'
import { isExistWindow, sendEvent } from './index'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { compareVersions, downloadSources, getUpdateVersion } from '@common/utils/updateSources'
import { createUpdateProvider, loadUpdateMetadata, requestUpdate } from './updateProvider'
import { SERVICE_PREVIEW } from '@common/servicePreview'

autoUpdater.logger = log
autoUpdater.autoDownload = false
let operation: Promise<void> | null = null
let prepared = false
let sourceIndex = 0
let downloadOrder = downloadSources
let touchDownload: ((transferred?: number) => void) | null = null
const isPackageManagerInstall = () => process.platform === 'linux' && process.env.Q_MUSIC_PACKAGE_TYPE === 'pacman'
const report = (type: string, info: any) => {
  if (isExistWindow()) sendEvent(type, info)
}
const reportError = (error: unknown) => {
  report(WIN_MAIN_RENDERER_EVENT_NAME.update_error, error instanceof Error ? error.message : '更新失败，请检查网络后重试')
}
const run = (task: () => Promise<void>) => {
  if (operation) return
  operation = task().catch(reportError).finally(() => { operation = null })
}

const download = async() => {
  if (isPackageManagerInstall()) return
  let lastError: unknown
  const attempts = [...downloadOrder.map(source => downloadSources.indexOf(source)), downloadSources.indexOf(downloadOrder[0])]
  for (const [attempt, index] of attempts.entries()) {
    sourceIndex = index
    const source = downloadSources[index]
    const token = new CancellationToken()
    let timer: ReturnType<typeof setTimeout>
    let received = -1
    touchDownload = (transferred = 0) => {
      if (transferred <= received) return
      received = transferred
      clearTimeout(timer)
      timer = setTimeout(() => { token.cancel() }, 30000)
    }
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
      total: 0,
      transferred: 0,
      percent: 0,
      bytesPerSecond: 0,
      delta: 0,
      sourceLabel: `${attempt ? '正在重试，' : ''}使用${source.name}下载（${attempt + 1}/${attempts.length}）`,
    })
    // 镜像不一定支持差分块请求，完整包仍由 electron-updater 校验 SHA-512。
    autoUpdater.disableDifferentialDownload = source.prefix != ''
    try {
      touchDownload()
      await autoUpdater.downloadUpdate(token)
      return
    } catch (error) {
      lastError = error
      log.warn(`Update download attempt ${attempt + 1} failed`, error)
    } finally {
      clearTimeout(timer!)
      // run 保证整个检查/下载过程互斥，此处不会覆盖其他下载任务。
      // eslint-disable-next-line require-atomic-updates
      touchDownload = null
    }
  }
  throw new Error(`下载失败，已尝试全部线路，请检查网络后重试。${lastError instanceof Error ? lastError.message : ''}`)
}

const check = async(shouldDownload: boolean) => {
  prepared = false
  const version = await getUpdateVersion(requestUpdate, 'desktop')
  if (compareVersions(version.version, process.versions.app ?? autoUpdater.currentVersion.version) <= 0 || isPackageManagerInstall()) {
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_not_available, { version: version.version, releaseNotes: version.desc })
    return
  }
  if (isWin && process.arch.includes('arm')) throw new Error('此架构请从发布页下载安装包更新')
  const { info, sources } = await loadUpdateMetadata(version.version, version.assets)
  downloadOrder = sources
  info.releaseNotes = version.desc
  sourceIndex = 0
  autoUpdater.setFeedURL({
    provider: 'custom',
    updateProvider: createUpdateProvider(info, () => downloadSources[sourceIndex].prefix),
    timeout: 15000,
  })
  const result = await autoUpdater.checkForUpdates()
  if (!result) throw new Error('当前运行方式不支持自动安装，请使用正式安装版或从发布页下载')
  prepared = result.isUpdateAvailable
  if (prepared && shouldDownload) await download()
}

export default () => {
  if (SERVICE_PREVIEW) return
  autoUpdater.on('update-available', info => {
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_available, info)
  })
  autoUpdater.on('update-not-available', info => {
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_not_available, info)
  })
  // 中间失败由重试流程处理，全部线路失败后才通知界面。
  autoUpdater.on('error', error => { log.warn('Auto-updater', error) })
  autoUpdater.on('download-progress', progress => {
    touchDownload?.(progress.transferred)
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, sourceLabel: `正在使用${downloadSources[sourceIndex].name}下载` })
  })
  autoUpdater.on('update-downloaded', info => {
    report(WIN_MAIN_RENDERER_EVENT_NAME.update_downloaded, info)
  })
  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.update_check, () => {
    run(async() => check(global.lx.appSetting['common.tryAutoUpdate']))
  })
  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.update_download_update, () => {
    if (isPackageManagerInstall()) return
    run(async() => { if (prepared) await download(); else await check(true) })
  })
  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.quit_update, () => {
    if (isPackageManagerInstall()) return
    global.lx.isSkipTrayQuit = true
    setTimeout(() => { autoUpdater.quitAndInstall(true, true) }, 1000)
  })
}
