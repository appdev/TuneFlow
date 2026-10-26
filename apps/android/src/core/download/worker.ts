import RNFS from 'react-native-fs'

// 下载只解析在线地址，不能复用播放器的本地文件优先策略。
import { getMusicPlayUrlInfo } from '@/core/music/online'
import { getWorkspace } from '@/service/session'
import { downloadWithConfirmation, replacementMessage } from '@/service/downloads'
import { confirmDialog } from '@/utils/tools'
import { NativeModules } from 'react-native'
import {
  getDownloadTask,
  removeDownloadTask,
  upsertDownloadTask,
} from './store'
import type { DownloadStatus, DownloadTaskInfo } from './types'

const { UtilsModule } = NativeModules

// 公共音乐目录；文件操作前检查对应系统版本的存储授权，系统播放器可见。
const DOWNLOAD_DIR = `${RNFS.ExternalStorageDirectoryPath}/Music/QMusic`
const PROGRESS_THROTTLE = 300
const MAX_CONCURRENT = 2

const runningTasks = new Set<string>()
const deletingTasks = new Set<string>()
const waitingQueue: string[] = []

const formatSpeed = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '--'
  const mb = bytesPerSecond / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)}M/s` : `${Math.max(bytesPerSecond / 1024, 1).toFixed(0)}K/s`
}

const patchTask = (id: string, patch: Partial<DownloadTaskInfo>) => {
  const task = getDownloadTask(id)
  if (!task) return
  upsertDownloadTask({ ...task, ...patch })
}

const scanMediaFile = async(filePath: string) => {
  try {
    await UtilsModule.scanMediaFile(filePath)
  } catch (err) {
    console.log('scan media file failed', err)
  }
}

const runTask = async(taskId: string) => {
  const task = getDownloadTask(taskId)
  if (!task) return

  patchTask(taskId, { status: 'run', statusText: '' })

  try {
    const { url } = await getMusicPlayUrlInfo({
      musicInfo: task.musicInfo,
      quality: task.quality,
      isRefresh: false,
      allowToggleSource: false,
    })

    const dirExists = await RNFS.exists(DOWNLOAD_DIR)
    if (!dirExists) await RNFS.mkdir(DOWNLOAD_DIR)

    const filePath = `${DOWNLOAD_DIR}/${task.fileName}`
    const toFile = `${RNFS.CachesDirectoryPath}/download_${taskId}.tmp`

    let lastEmit = 0
    let lastBytes = 0
    let lastTime = 0
    const downloadPromise = RNFS.downloadFile({
      fromUrl: url,
      toFile,
      background: false,
      progressInterval: PROGRESS_THROTTLE,
      progress: (res) => {
        const now = Date.now()
        if (now - lastEmit < PROGRESS_THROTTLE) return
        const elapsed = lastTime ? (now - lastTime) / 1000 : 0
        const speed = elapsed > 0 ? formatSpeed((res.bytesWritten - lastBytes) / elapsed) : ''
        lastEmit = now
        lastBytes = res.bytesWritten
        lastTime = now
        patchTask(taskId, {
          progress: Math.min(Math.round((res.bytesWritten / Math.max(res.contentLength, 1)) * 100), 100),
          downloaded: res.bytesWritten,
          total: res.contentLength,
          speed,
        })
      },
    })

    const result = await downloadPromise.promise
    if (result.statusCode && result.statusCode >= 400) throw new Error(`download failed: ${result.statusCode}`)

    if (await RNFS.exists(filePath)) await RNFS.unlink(filePath)
    await RNFS.moveFile(toFile, filePath)
    await scanMediaFile(filePath)

    patchTask(taskId, {
      status: 'completed',
      progress: 100,
      statusText: '',
      filePath,
    })
  } catch (err: any) {
    patchTask(taskId, {
      status: 'error',
      statusText: err?.message ?? 'download failed',
    })
  }
}

const scheduleNext = () => {
  while (runningTasks.size < MAX_CONCURRENT && waitingQueue.length) {
    const taskId = waitingQueue.shift()!
    if (runningTasks.has(taskId) || deletingTasks.has(taskId) || getDownloadTask(taskId)?.status != 'waiting') continue
    runningTasks.add(taskId)
    void runTask(taskId).finally(() => {
      runningTasks.delete(taskId)
      scheduleNext()
    })
  }
}

/**
 * 添加下载任务：自动请求存储权限，去重后进入下载队列
 */
export const downloadMusics = async(musicInfos: LX.Music.MusicInfoOnline[], quality: LX.Quality) => {
  const workspace = getWorkspace()
  for (const musicInfo of musicInfos) {
    const track = workspace.original(musicInfo)
    if (track.source !== 'local' && !await downloadWithConfirmation(workspace.client, track, quality,
      async() => confirmDialog({ message: replacementMessage(track.name, quality), confirmButtonText: '重新下载并替换' }),
      () => workspace === getWorkspace())) return false
  }
  return true
}

export const retryDownload = (taskId: string) => {
  const task = getDownloadTask(taskId)
  if (!task || task.status != 'error' || runningTasks.has(taskId) || deletingTasks.has(taskId)) return
  patchTask(taskId, { status: 'waiting', statusText: '', progress: 0 })
  waitingQueue.push(taskId)
  scheduleNext()
}

export const deleteDownloadTask = async(taskId: string, deleteFile = false) => {
  const task = getDownloadTask(taskId)
  if (!task || runningTasks.has(taskId) || deletingTasks.has(taskId)) return
  deletingTasks.add(taskId)
  try {
    if (deleteFile && task.filePath) {
      if (await RNFS.exists(task.filePath)) await RNFS.unlink(task.filePath)
    }
    // 成功后再移除记录；失败时保留任务，用户可以重试。
    for (let index = waitingQueue.length - 1; index >= 0; index--) {
      if (waitingQueue[index] == taskId) waitingQueue.splice(index, 1)
    }
    removeDownloadTask(taskId)
  } finally {
    deletingTasks.delete(taskId)
  }
}

export type { DownloadStatus, DownloadTaskInfo }
