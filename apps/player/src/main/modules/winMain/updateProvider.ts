import { request } from '@common/utils/request'
import { createHash } from 'node:crypto'
import { Provider, parseUpdateInfo, resolveFiles, type ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { type UpdateInfo } from 'builder-util-runtime'
import { assetUrl, downloadSources, downloadUrl, probeDownloadSources, type ReleaseAsset } from '@common/utils/updateSources'

export const requestUpdate = async(url: string, json = true): Promise<any> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 8000)
  try {
    const response = await request(url, { signal: controller.signal, timeout: 8000, retryNum: 0 })
    if (response.statusCode != 200) throw new Error(`更新服务器返回 ${response.statusCode}`)
    return json && typeof response.body == 'string' ? JSON.parse(response.body) : response.body
  } finally { clearTimeout(timer) }
}

export const loadUpdateMetadata = async(version: string, assets: ReleaseAsset[] = []) => {
  const channel = process.platform == 'darwin' ? 'latest-mac.yml' : process.platform == 'linux' ? 'latest-linux.yml' : 'latest.yml'
  const url = assetUrl(version, channel)
  const digest = assets.find(asset => asset.name == channel)?.digest
  const results = await probeDownloadSources(async(source) => {
    const content: string = await requestUpdate(downloadUrl(source, url), false)
    if (/^sha256:[a-f\d]{64}$/i.test(digest ?? '') && createHash('sha256').update(content).digest('hex') != digest!.slice(7).toLowerCase()) {
      throw new Error('更新元数据校验失败')
    }
    const info = parseUpdateInfo(content, channel, new URL(url))
    if (info.version != version || !info.files?.length || info.files.some(file => !file.sha512)) throw new Error('更新文件校验信息无效')
    // 发布文件必须来自已选定版本，备用线路不能改变目标版本或文件名。
    for (const file of info.files) assetUrl(version, file.url)
    return info
  })
  if (!results.length) throw new Error('无法获取当前平台的安装包信息，请检查网络后重试')
  const info = (results.find(result => result.source.prefix == '') ?? results[0]).value
  const sources = results.filter(result => JSON.stringify(result.value.files) == JSON.stringify(info.files)).map(result => result.source)
  return { info, sources: [...sources, ...downloadSources.filter(source => !sources.includes(source))] }
}

// 切换时只改变下载地址，版本、文件大小和 SHA-512 始终沿用首次取得的元数据。
export const createUpdateProvider = (info: UpdateInfo, getPrefix: () => string) => {
  return class extends Provider<UpdateInfo> {
    constructor(_options: unknown, _updater: unknown, runtime: ProviderRuntimeOptions) {
      super({ ...runtime, isUseMultipleRangeRequest: false })
    }

    async getLatestVersion() { return info }

    resolveFiles(updateInfo: UpdateInfo) {
      return resolveFiles(updateInfo, new URL('.', downloadUrl({ prefix: getPrefix() }, assetUrl(info.version, 'latest.yml'))))
    }
  }
}
