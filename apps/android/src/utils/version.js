import { httpGet } from '@/utils/request'
import { downloadFile, stopDownload, temporaryDirectoryPath, hash, existsFile, unlink } from '@/utils/fs'
import { getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import { assetUrl, checksumFor, downloadSources, downloadUrl, getUpdateVersion, probeDownloadSources } from './updateSources'

const request = async(url, format = 'json') => new Promise((resolve, reject) => {
  httpGet(url, { timeout: 8000, format }, (err, response, body) => {
    if (err || response?.statusCode != 200) reject(err || new Error('更新信息获取失败'))
    else resolve(body)
  })
})
let lastVersionInfo
export const getVersionInfo = async() => {
  lastVersionInfo = await getUpdateVersion(request, 'android')
  return lastVersionInfo
}

const getTargetAbi = async() => {
  const supported = await getSupportedAbis()
  return ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].find(abi => supported.includes(abi)) || 'universal'
}
let downloadPromise = null
let apkSavePath

const getDownloadPlan = async(version, name) => {
  const asset = lastVersionInfo?.version == version ? lastVersionInfo.assets?.find(asset => asset.name == name) : null
  const results = await probeDownloadSources(async(source) => checksumFor(await request(downloadUrl(source, assetUrl(version, 'SHA256SUMS-android.txt')), 'text'), name))
  const checksum = /^sha256:[a-f\d]{64}$/i.test(asset?.digest || '')
    ? asset.digest.slice(7).toLowerCase()
    : (results.find(result => result.source.prefix == '') ?? results[0])?.value
  if (!checksum) throw new Error('无法获取安装包校验信息，请稍后重试')
  const sources = results.filter(result => result.value == checksum).map(result => result.source)
  return { checksum, sources: [...sources, ...downloadSources.filter(source => !sources.includes(source))] }
}

const downloadApk = async(version, onDownload, onStatus) => {
  const abi = await getTargetAbi()
  const name = `Q-music-android-v${version}-${abi}.apk`
  const url = assetUrl(version, name)
  const savePath = `${temporaryDirectoryPath}/${name}`
  onStatus('正在检测下载线路并获取校验信息…')
  const { checksum, sources } = await getDownloadPlan(version, name)
  apkSavePath = null
  // 完整文件可复用，损坏或不完整的文件不能进入安装流程。
  if (await existsFile(savePath) && await hash(savePath, 'sha256') == checksum) {
    apkSavePath = savePath
    return
  }
  let lastError
  const attempts = [...sources, sources[0]]
  for (const [index, source] of attempts.entries()) {
    if (await existsFile(savePath)) await unlink(savePath)
    onDownload(0, 0)
    onStatus(`${index ? '正在重试，' : ''}使用${source.name}下载（${index + 1}/${attempts.length}）`)
    let jobId
    let timer
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (jobId != null) stopDownload(jobId) }, 30000)
    }
    try {
      let expectedLength = 0
      let received = 0
      const job = downloadFile(downloadUrl(source, url), savePath, {
        progressInterval: 500,
        connectionTimeout: 12000,
        readTimeout: 30000,
        begin({ contentLength }) { expectedLength = contentLength; touch(); onDownload(contentLength, 0) },
        progress({ contentLength, bytesWritten }) {
          if (bytesWritten > received) { received = bytesWritten; touch() }
          onDownload(contentLength, bytesWritten)
        },
      })
      jobId = job.jobId
      touch()
      const result = await job.promise
      clearTimeout(timer)
      if (result.statusCode != 200 || result.bytesWritten <= 0 || (expectedLength > 0 && result.bytesWritten != expectedLength)) {
        throw new Error('安装包下载不完整')
      }
      onStatus('下载完成，正在校验安装包…')
      if (await hash(savePath, 'sha256') != checksum) throw new Error('安装包校验失败')
      apkSavePath = savePath
      return
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  if (await existsFile(savePath)) await unlink(savePath)
  throw new Error(`下载失败，已尝试全部线路，请检查网络后重试。${lastError?.message || ''}`)
}

export const downloadNewVersion = (version, onDownload = (total, current) => {}, onStatus = (message) => {}) => {
  if (downloadPromise) return downloadPromise
  downloadPromise = downloadApk(version, onDownload, onStatus).finally(() => { downloadPromise = null })
  return downloadPromise
}

export const updateApp = async() => {
  if (!apkSavePath || !await existsFile(apkSavePath)) throw new Error('安装包不存在，请重新下载')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
