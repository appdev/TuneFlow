import mirrorConfig from './updateMirror.json'

// 自有 R2 域名在发版前配置；留空时仍可用 GitHub 与公共镜像。
export const mirrorBase = /^https:\/\/[^\s?#]+$/.test(mirrorConfig.baseUrl) ? mirrorConfig.baseUrl.replace(/\/$/, '') : ''
// 仅用于公开发布文件，不携带账号、Cookie 或用户配置。
export const downloadSources = [
  ...(mirrorBase ? [{ name: '官方镜像', prefix: mirrorBase }] : []),
  { name: 'GitHub', prefix: '' },
  { name: '备用线路 1', prefix: 'https://ghfast.top/' },
  { name: '备用线路 2', prefix: 'https://gh-proxy.com/' },
]
export const releaseBase = 'https://github.com/appdev/Q-music/releases/download/'
export const downloadUrl = (source: { prefix: string }, url: string) => {
  if (!url.startsWith(releaseBase)) throw new Error('不是 Q-music 发布文件')
  return mirrorBase && source.prefix == mirrorBase ? `${mirrorBase}/releases/${url.slice(releaseBase.length)}` : source.prefix + url
}
export interface ReleaseAsset { name: string, size?: number, digest?: string }
export interface UpdateVersion {
  version: string
  desc: string
  history: Array<{ version: string, desc: string }>
  assets?: ReleaseAsset[]
}
type Request = (url: string) => Promise<any>
export const validVersion = (version: unknown): version is string => typeof version == 'string' && /^\d+\.\d+\.\d+$/.test(version)
export const compareVersions = (a: string, b: string) => {
  const aa = a.split('.').map(Number)
  const bb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if (aa[i] != bb[i]) return aa[i] - bb[i] }
  return 0
}

export const getUpdateVersion = async(request: Request, platform: 'desktop' | 'android'): Promise<UpdateVersion> => {
  const path = platform == 'android' ? 'mobile-version.json' : 'version.json'
  const urls = [
    'https://api.github.com/repos/appdev/Q-music/releases?per_page=30',
    `https://raw.githubusercontent.com/appdev/Q-music/master/publish/${path}`,
    `https://cdn.jsdelivr.net/gh/appdev/Q-music@master/publish/${path}`,
    `https://ghfast.top/https://raw.githubusercontent.com/appdev/Q-music/master/publish/${path}`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/appdev/Q-music/master/publish/${path}`,
    ...(mirrorBase ? [`${mirrorBase}/channels/${platform}.json`] : []),
  ]
  // 同时检查独立线路，避免坏线路反复阻塞；比较版本，避免 CDN 旧缓存抢先返回。
  const results = await Promise.allSettled(urls.map(async(url, index): Promise<UpdateVersion> => {
    const body = await request(url)
    if (index == 0) {
      if (!Array.isArray(body)) throw new Error('发布信息格式错误')
      const releases = body.filter(release => !release.draft && (!release.prerelease || String(release.body).includes('<!-- qmusic-service-preview -->')) &&
        validVersion(String(release.tag_name ?? '').replace(/^v/, '')) &&
        release.assets?.some((asset: ReleaseAsset) => platform == 'android'
          ? /^Q-music-android-v[\d.]+-.+\.apk$/.test(asset.name)
          : /^(?:latest(?:-mac|-linux)?\.yml)$|\.(?:exe|dmg|appimage|deb|rpm|pacman)$/i.test(asset.name)))
      releases.sort((a, b) => compareVersions(String(b.tag_name).replace(/^v/, ''), String(a.tag_name).replace(/^v/, '')))
      if (!releases.length) throw new Error('没有找到当前平台的正式版')
      const release = releases[0]
      return { version: release.tag_name.replace(/^v/, ''), desc: release.body || release.name || '', history: [], assets: release.assets }
    }
    if (!body || !validVersion(body.version)) throw new Error('版本信息格式错误')
    return { version: body.version, desc: typeof body.desc == 'string' ? body.desc : '', history: Array.isArray(body.history) ? body.history : [], assets: Array.isArray(body.assets) ? body.assets : undefined }
  }))
  const versions = results.flatMap(result => result.status == 'fulfilled' ? [result.value] : [])
  if (!versions.length) throw new Error('更新线路暂时均不可用，请检查网络后重试')
  versions.sort((a, b) => compareVersions(b.version, a.version))
  // API 可用时以已经公开的正式 Release 为准，避免仓库中待发布的版本提前触发更新。
  const newest = results[0].status == 'fulfilled' ? results[0].value : versions[0]
  newest.assets = versions.find(info => info.version == newest.version && info.assets?.length)?.assets
  newest.history = versions.find(info => info.version == newest.version && info.history.length)?.history ?? []
  return newest
}

export const assetUrl = (version: string, name: string) => {
  if (!validVersion(version) || !/^[\w.+-]+$/.test(name)) throw new Error('更新文件地址无效')
  return `${releaseBase}v${version}/${name}`
}

export const checksumFor = (body: unknown, name: string) => {
  if (typeof body != 'string') throw new Error('校验文件格式错误')
  for (const line of body.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match?.[2] == name) return match[1].toLowerCase()
  }
  throw new Error('发布文件缺少 SHA-256 校验值')
}

export const probeDownloadSources = async<T>(probe: (source: typeof downloadSources[number]) => Promise<T>) => {
  const results = await Promise.allSettled(downloadSources.map(async(source) => {
    const start = Date.now()
    const value = await probe(source)
    return { source, value, elapsed: Date.now() - start }
  }))
  return results.flatMap(result => result.status == 'fulfilled' ? [result.value] : []).sort((a, b) => a.elapsed - b.elapsed)
}
