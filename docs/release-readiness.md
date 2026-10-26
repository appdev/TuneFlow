# 多平台构建与发布检查

检查日期：2026-10-26。服务端源码版本 `2.13.8`；桌面、Web、Android 源码版本 `0.4.27`。版本提交、构建成功和公开发布是不同状态。

## 能力与边界

| 产物 | 当前 Actions 能力 | 发布条件／限制 |
| --- | --- | --- |
| macOS | x64、arm64 ZIP | 预览通道，临时签名、未公证，不是正式签名安装器 |
| Windows | x64、arm64 ZIP | 未签名便携版，无应用内自动安装更新 |
| Linux 桌面 | x64、arm64 tar.gz | 便携包，不包含该流程未配置的 deb、rpm 等安装包 |
| Web | 主界面与 `/V2/` 的 tar.gz | 独立下载包，也随服务镜像提供；构建不等于部署 |
| Android | arm64-v8a、universal 通用 APK | 通用版保留其他架构的原生库；沿用 `.preview` 应用 ID 与原预览签名，覆盖升级；不属于应用商店正式签名包 |
| 服务端 Docker | `linux/amd64` | 健康、配置／音乐存储检查后推送 Docker Hub；当前不发布服务端 GitHub Release，尚无 arm64 镜像构建验证 |

此仓库没有 iOS 发布流程。独立 Flutter 项目不属于本次发布矩阵。

## 实际检查结果

- 本次客户端冻结源码为 `0e839202b2b9d6f63b4d222cb3d85e7c03de2cc7`，标签为 `TuneFlow-v0.4.27`；服务镜像仍为上一轮冻结源码 `e2a0bdcb1227180fb48c8fc306907f5ccc0278bc`。
- [客户端 run 40343194638](https://github.com/appdev/TuneFlow/actions/runs/40343194638)：版本检查、六个桌面目标、Web、Android 及发布全部成功。Android 额外验证应用 ID、签名、arm64 版本码 `55003`、通用版版本码 `55005` 及通用包的四种原生架构。
- [客户端 0.4.27 预览版](https://github.com/appdev/TuneFlow/releases/tag/TuneFlow-v0.4.27) 已公开，包含 9 个 TuneFlow 平台包及 6 个摘要／清单附件。Android 仅发布 arm64-v8a、universal 两个 APK。独立下载清单和校验文件，与 GitHub 公开附件摘要、大小核对通过；桌面与 Android 更新通道均指向本次客户端冻结源码和已公开附件。
- 应用户要求，在新版公开验证后删除 `TuneFlow-v0.4.26` Release 及其附件；已确认旧 Release 查询返回 404，源码标签保留以便追溯。已安装 0.4.26 的 Android 使用旧下载文件名，需要手动下载新版覆盖安装一次，无需卸载。新版更新下载已使用 TuneFlow 文件名和两种 APK 选择。
- [Docker run 40337092339](https://github.com/appdev/TuneFlow/actions/runs/40337092339)：构建、健康、存储检查和镜像推送成功，服务端 GitHub Release 步骤跳过。Docker Hub `apkdv/tuneflow-server:2.13.8` 与 `latest` 摘要一致：`sha256:332f4c8e6666f0b524dc4540b27fb8ee2f3b6db073116094cae354c52430c0a0`，平台 `linux/amd64`。
- [共享契约 run 40335883068](https://github.com/appdev/TuneFlow/actions/runs/40335883068) 与 [服务端完整检查 run 40335875429](https://github.com/appdev/TuneFlow/actions/runs/40335875429) 均通过。
- 用户确认原 Q-music 发布仓库已删除。当前源码将客户端发布、下载及 API／raw／CDN 更新线路统一迁移到 TuneFlow，使用 `TuneFlow-v<version>` 标签；不再需要旧仓库调用器。`appdev/TuneFlow-Client` 是独立 Flutter 仓库，不参与发布。

结论：本次跨平台预览包、公开更新通道及 Docker Hub 发布已验证。发布不等于部署，本次未更新测试服务器的现有容器。服务镜像缺少 arm64，正式签名与公证也未覆盖。

## 触发方式

- [客户端 Action](../.github/workflows/release-client.yml)：PR 检查，或手动指定不可变 `source_ref`，按 `all`、`desktop`、`web`、`android` 构建。默认只上传构建附件；选择 `publish=true` 后直接在 TuneFlow 发布预览版。
- 所有选中构建与验证成功后，发布脚本核对附件完整性、计算 SHA-256、拒绝覆盖不同内容的已有附件，再核对已公开附件的摘要和大小，最后创建或更新 `main` 分支的 `channels/desktop.json`、`channels/android.json`。这些文件只在发布成功后写入，客户端不读取源码中待发布的版本文件。服务端 `v<version>` 和独立 Web 附件不会被误识别为客户端更新。
- [Docker Action](../.github/workflows/docker-build.yml)：PR 仅构建检查；手动 `push_image=true`、`publish_release=false` 推送 Docker Hub。本项目当前不使用其可选的服务端 GitHub Release 功能。
- [共享检查](../.github/workflows/monorepo-checks.yml) 和 [服务检查](../.github/workflows/build-test.yml) 当前仅由 PR 或手动触发。
- 当前配置不会因向 `main` 推送提交或创建标签而自动启动构建／发布；需要另行手动运行。不要把“代码已推送”表述为“新版本已发布”。

## 下次公开发布前

1. 原发布仓库已删除，旧版无法从旧地址收到升级。首次迁移需要手动下载新仓库的预览包，保留应用 ID、预览签名及原数据目录覆盖安装；不能保证以不同签名或应用 ID 安装的版本可覆盖升级。
2. 在冻结提交上运行所需构建和共享契约检查，确认版本、Android versionCode、应用 ID、签名及现有数据兼容。
3. Docker 从冻结源码运行健康检查与镜像发布，使用服务版本镜像标签，不额外创建服务端 GitHub Release；若需要 ARM 服务器，先增加并验证 arm64 构建及运行能力。
4. 发布后独立核对附件清单、摘要、公开更新元数据及镜像摘要。正式签名／公证和商店上架需要另外配置，不能从预览包构建成功推断。
