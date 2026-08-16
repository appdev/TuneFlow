import { markRaw, toRaw } from '@common/utils/vueTools'
import { DOWNLOAD_STATUS } from '@common/constants'
import { qualityList } from '..'
import { downloadList } from './state'
import { dialog } from '@renderer/plugins/Dialog'
import { runUserDownloads, ServiceRequestError } from './userDownload'

interface ServiceDownloadDto {
  id: string
  status: 'waiting' | 'running' | 'paused' | 'error' | 'completed'
  musicInfo: TuneFlow.Music.MusicInfoOnline
  quality: TuneFlow.Quality
  extension: TuneFlow.Download.FileExt
  fileName: string
  downloaded: number
  total: number
  progress: number
  warning?: string
  error?: string
  listId?: string
}

const serviceRequest = async<T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const failure = (await response.json().catch(() => null))?.error
    throw new ServiceRequestError(response.status, failure?.code ?? 'DOWNLOAD_REQUEST_FAILED', failure?.message ?? `Download request failed (${response.status})`, failure?.details)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()).data as T
}

const serviceStatus = (status: ServiceDownloadDto['status']): TuneFlow.Download.DownloadTaskStatus => ({
  waiting: DOWNLOAD_STATUS.WAITING,
  running: DOWNLOAD_STATUS.RUN,
  paused: DOWNLOAD_STATUS.PAUSE,
  error: DOWNLOAD_STATUS.ERROR,
  completed: DOWNLOAD_STATUS.COMPLETED,
}[status] as TuneFlow.Download.DownloadTaskStatus)

const serviceStatusText = (task: ServiceDownloadDto): string => task.error ?? task.warning ?? ({
  waiting: window.i18n.t('download___status_waiting'),
  running: window.i18n.t('download___status_running'),
  paused: window.i18n.t('download___status_paused'),
  error: window.i18n.t('download___status_error'),
  completed: window.i18n.t('download___status_completed'),
}[task.status] as string)

const fromService = (task: ServiceDownloadDto): TuneFlow.Download.ListItem => ({
  id: task.id,
  isComplate: task.status === 'completed',
  status: serviceStatus(task.status),
  statusText: serviceStatusText(task),
  downloaded: task.downloaded,
  total: task.total,
  progress: task.progress,
  speed: '',
  writeQueue: 0,
  metadata: {
    musicInfo: markRaw(task.musicInfo),
    url: null,
    quality: task.quality,
    ext: task.extension,
    fileName: task.fileName,
    filePath: '',
    listId: task.listId,
  },
})

const reconcileServiceDownloads = (tasks: ServiceDownloadDto[]) => {
  downloadList.splice(0, downloadList.length, ...tasks.map(fromService))
  window.app_event.downloadListUpdate()
}

let serviceSubscribed = false
const subscribeServiceDownloads = () => {
  if (serviceSubscribed) return
  const runtime = (globalThis as typeof globalThis & { tuneFlowWebRuntime?: { on: (name: string, listener: (event: { params: ServiceDownloadDto[] }) => void) => void } }).tuneFlowWebRuntime
  if (runtime == null) return
  runtime.on('service_downloads', ({ params }) => { reconcileServiceDownloads(params) })
  serviceSubscribed = true
}

export const getDownloadList = async(): Promise<TuneFlow.Download.ListItem[]> => {
  reconcileServiceDownloads(await serviceRequest<ServiceDownloadDto[]>('GET', '/api/v1/downloads'))
  subscribeServiceDownloads()
  return downloadList
}

export const createDownloadTasks = async(
  list: TuneFlow.Music.MusicInfoOnline[],
  quality: TuneFlow.Quality,
  listId?: string,
  options: { skipExisting?: boolean, qualityPolicy?: 'selected' | 'highest' } = {},
) => {
  if (!list.length) return
  subscribeServiceDownloads()
  const request = async(musicInfo: TuneFlow.Music.MusicInfoOnline, existingFilePolicy: 'error' | 'replace' | 'reuse') => {
    await serviceRequest<ServiceDownloadDto>('POST', '/api/v1/downloads', {
      musicInfo: toRaw(musicInfo),
      quality,
      qualityList: toRaw(qualityList.value),
      listId,
      ...options,
      existingFilePolicy,
    })
  }
  if (options.skipExisting === true) {
    for (const musicInfo of list) await request(musicInfo, 'reuse')
  } else {
    await runUserDownloads(list, request, async details => dialog.confirm({
      message: window.i18n.t('download__replace_existing', { fileName: details.fileName ?? '' }),
      cancelButtonText: window.i18n.t('btn_cancel'),
      confirmButtonText: window.i18n.t('btn_confirm'),
    }))
  }
  reconcileServiceDownloads(await serviceRequest<ServiceDownloadDto[]>('GET', '/api/v1/downloads'))
}

export const startDownloadTasks = async(list: TuneFlow.Download.ListItem[]) => {
  await Promise.all(list.map(async task => serviceRequest('POST', `/api/v1/downloads/${encodeURIComponent(task.id)}/start`)))
}

export const pauseDownloadTasks = async(list: TuneFlow.Download.ListItem[]) => {
  await Promise.all(list.map(async task => serviceRequest('POST', `/api/v1/downloads/${encodeURIComponent(task.id)}/pause`)))
}

export const removeDownloadTasks = async(ids: string[]) => {
  await Promise.all(ids.map(async id => serviceRequest('DELETE', `/api/v1/downloads/${encodeURIComponent(id)}`)))
}
