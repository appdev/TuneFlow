# 更新下载线路

PC 和 Android 默认自动检测 GitHub、`ghfast.top`、`gh-proxy.com`，按当前版本校验文件的响应时间选择线路。检测是小文件连通性检查，不代表大文件的持续下载速度。公共镜像无需维护者配置密钥，但可用性不作保证。

- 版本检查并行访问 GitHub API、原始版本文件、jsDelivr 和两条镜像，排除预发布并区分桌面/安卓；多个有效结果取较新版本，避免旧 CDN 缓存先返回造成漏报。
- 下载前检测当前版本的元数据，下载无进展约 30 秒后停止该次请求，自动换线；所有线路尝试后，最后重试首选线路一次。每次换线重置进度。
- PC 沿用 electron-updater 的 SHA-512 校验和完整文件缓存；公共镜像禁用差分下载。Android 使用 SHA-256，检查 HTTP 状态及下载大小，已完成且校验通过的 APK 可复用。
- 当前没有实现 Android 跨失败任务的断点续传；不完整文件换线后重新下载。关闭更新弹窗只是收起，下载仍继续。
- 优先使用 GitHub API 提供的 Android asset digest；API 不可达时使用发布中的 `SHA256SUMS-android.txt`。PC 使用同版本 `latest.yml` 中的校验值。校验用于检查文件完整性，镜像提供的校验文件不是独立签名。Android 覆盖安装还会由系统验证应用签名。

参考 FufuLauncher 的镜像探测、响应时间排序与下载校验思路，使用 Q-music 自己的发布文件探测，保留正常 HTTPS 证书验证。没有接入其私有下载站，也没有照搬大规模第三方镜像列表。

## 可选的自有 Cloudflare R2

本次默认使用公共镜像，不需要开通 R2 或配置 OneDrive。已保留自有镜像地址配置，但没有创建云资源或部署同步任务。

将 PC 的 `src/common/utils/updateMirror.json`、Android 的 `src/utils/updateMirror.json` 中 `baseUrl` 填为同一公开 HTTPS 下载域名后，重新构建客户端，即可将其纳入检测。留空不会请求自有镜像。它是公开下载域名，不能填写 S3 API 端点或密钥。

自有存储应提供以下路径：

```text
channels/desktop.json
channels/android.json
releases/v0.4.10/latest.yml
releases/v0.4.10/Q-music-v0.4.10-x64-Setup.exe
releases/v0.4.10/SHA256SUMS-android.txt
releases/v0.4.10/Q-music-android-v0.4.10-arm64-v8a.apk
...其余架构及平台文件
```

通道 JSON 使用现有 `publish/version.json` / `publish/mobile-version.json` 的结构，可额外包含 GitHub Release 的 `assets`（含 `name`、`size`、`digest`）。先上传完整文件、校验文件，最后更新通道 JSON；通道文件应设短缓存或禁用缓存，版本目录不可覆盖不同内容。暂不推荐用 OneDrive 分享链接作为自动更新主源。

验证：PC `npm test`；Android `npm run test:update`。真实网络可用性和速度取决于用户所在网络，离线测试覆盖超时/失败换线、错误响应、校验失败和重复操作。
