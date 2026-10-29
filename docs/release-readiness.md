# 多平台构建与发布检查

检查日期：2026-10-27。服务端源码版本 `2.13.8`；桌面、Web、Android 源码版本 `0.4.27`。版本提交、构建成功和公开发布是不同状态。

## 能力与边界

| 产物 | 当前 Actions 能力 | 发布条件／限制 |
| --- | --- | --- |
| macOS | x64、arm64 ZIP | 预览通道，临时签名、未公证，不是正式签名安装器 |
| Windows | x64、arm64 ZIP | 未签名便携版，无应用内自动安装更新 |
| Linux 桌面 | x64、arm64 tar.gz | 便携包，不包含该流程未配置的 deb、rpm 等安装包 |
| Web | 随 Docker 镜像仅提供共享 Vue Web | 后续客户端 Actions 不再打包或发布独立 Web 附件；保留源码构建入口 |
| Android | arm64-v8a、universal 通用 APK | 通用版保留其他架构的原生库；沿用 `.preview` 应用 ID 与原预览签名，覆盖升级；不属于应用商店正式签名包 |
| 服务端 Docker | `linux/amd64` | 健康、配置／音乐存储检查后推送 Docker Hub；当前不发布服务端 GitHub Release，尚无 arm64 镜像构建验证 |

此仓库没有 iOS 发布流程。Flutter 客户端已弃用，不再维护；后续客户端验证与发布仅覆盖桌面、Web 和 Android。

## 实际检查结果

- 本次客户端冻结源码为 `0e839202b2b9d6f63b4d222cb3d85e7c03de2cc7`，标签为 `TuneFlow-v0.4.27`；服务镜像仍为上一轮冻结源码 `e2a0bdcb1227180fb48c8fc306907f5ccc0278bc`。
- [客户端 run 40343194638](https://github.com/appdev/TuneFlow/actions/runs/40343194638)：版本检查、六个桌面目标、Web、Android 及发布全部成功。Android 额外验证应用 ID、签名、arm64 版本码 `55003`、通用版版本码 `55005` 及通用包的四种原生架构。
- [客户端 0.4.27 预览版](https://github.com/appdev/TuneFlow/releases/tag/TuneFlow-v0.4.27) 已公开，包含 9 个 TuneFlow 平台包及 6 个摘要／清单附件。Android 仅发布 arm64-v8a、universal 两个 APK。独立下载清单和校验文件，与 GitHub 公开附件摘要、大小核对通过；桌面与 Android 更新通道均指向本次客户端冻结源码和已公开附件。
- 应用户要求，在新版公开验证后删除 `TuneFlow-v0.4.26` Release 及其附件；已确认旧 Release 查询返回 404，源码标签保留以便追溯。已安装 0.4.26 的 Android 使用旧下载文件名，需要手动下载新版覆盖安装一次，无需卸载。新版更新下载已使用 TuneFlow 文件名和两种 APK 选择。
- [Docker run 40337092339](https://github.com/appdev/TuneFlow/actions/runs/40337092339)：构建、健康、存储检查和镜像推送成功，服务端 GitHub Release 步骤跳过。Docker Hub `apkdv/tuneflow-server:2.13.8` 与 `latest` 摘要一致：`sha256:332f4c8e6666f0b524dc4540b27fb8ee2f3b6db073116094cae354c52430c0a0`，平台 `linux/amd64`。
- [共享契约 run 40335883068](https://github.com/appdev/TuneFlow/actions/runs/40335883068) 与 [服务端完整检查 run 40335875429](https://github.com/appdev/TuneFlow/actions/runs/40335875429) 均通过。
- 用户确认原 Q-music 发布仓库已删除。当前源码将客户端发布、下载及 API／raw／CDN 更新线路统一迁移到 TuneFlow，使用 `TuneFlow-v<version>` 标签；不再需要旧仓库调用器。原独立 Flutter 客户端（`appdev/TuneFlow-Client`）已弃用，不再维护或发布。

结论：本次跨平台预览包、公开更新通道及 Docker Hub 发布已验证。发布不等于部署，本次未更新测试服务器的现有容器。服务镜像缺少 arm64，正式签名与公证也未覆盖。

## 触发方式

- 2026-10-27 调整后续发布流程：客户端只发布六个桌面包和两个 Android APK，以及对应两组清单／校验文件（共 12 个附件）。当前 `0.4.27` Release、标签、附件及更新通道保持不变，本次不重新发布。
- [统一发布 Action](../.github/workflows/release.yml)：后续唯一发布入口。三端使用同一版本号与冻结源码，`publish=false` 默认只构建；`publish=true` 在全部构建通过后一起发布镜像和客户端。
- [客户端 Action](../.github/workflows/release-client.yml)：PR 或手动按 `all`、`desktop`、`android` 构建并上传 Actions 附件，无独立发布开关。`all` 仅含桌面和 Android。
- 所有选中构建与验证成功后，发布脚本核对附件完整性、计算 SHA-256、拒绝覆盖不同内容的已有附件，再核对已公开附件的摘要和大小，最后创建或更新 `main` 分支的 `channels/desktop.json`、`channels/android.json`。这些文件只在发布成功后写入，客户端不读取源码中待发布的版本文件。服务端 `v<version>` 和独立 Web 附件不会被误识别为客户端更新。
- [Docker Action](../.github/workflows/docker-build.yml)：PR／手动仅构建、健康和存储检查；统一流程调用时导出同一份已验证镜像，供发布任务加载使用。已移除单独推送和服务端 GitHub Release 入口。
- [共享检查](../.github/workflows/monorepo-checks.yml) 和 [服务检查](../.github/workflows/build-test.yml) 当前仅由 PR 或手动触发。
- 当前配置不会因向 `main` 推送提交或创建标签而自动启动构建／发布；需要另行手动运行。不要把“代码已推送”表述为“新版本已发布”。

## 下次公开发布前

1. 原发布仓库已删除，旧版无法从旧地址收到升级。首次迁移需要手动下载新仓库的预览包，保留应用 ID、预览签名及原数据目录覆盖安装；不能保证以不同签名或应用 ID 安装的版本可覆盖升级。
2. 在冻结提交上运行所需构建和共享契约检查，确认版本、Android versionCode、应用 ID、签名及现有数据兼容。
3. Docker 从冻结源码运行健康检查与镜像发布，使用服务版本镜像标签，不额外创建服务端 GitHub Release；若需要 ARM 服务器，先增加并验证 arm64 构建及运行能力。
4. 发布后独立核对附件清单、摘要、公开更新元数据及镜像摘要。正式签名／公证和商店上架需要另外配置，不能从预览包构建成功推断。

## 统一版本与发布操作

本次只修改后续流程，不修改现有 `2.13.8` 服务版本和 `0.4.27` 客户端版本，不重新发布。当前版本不一致时，统一流程会在构建前拒绝继续；独立构建检查仍可运行。下一次应选择高于已有服务端和客户端的统一版本号，例如 `2.13.9`，避免任一端降级；示例不代表该版本已发布。

1. 将 `apps/service`、`apps/player`、`apps/android` 的 `package.json` 与各自 `package-lock.json`（含 `packages[""].version`）对齐到相同版本。递增 Android `versionCode`，保留应用 ID、预览签名、配置键和数据目录。
2. 对齐 `apps/player/publish/version.json`、`mobile-version.json`、`service-version.json` 和 `apps/android/publish/mobile-version.json`，维护变更记录，准备 `apps/service/docs/releases/<version>.md`。发布说明与静态源码记录应与实际改动一致；最终镜像标签、附件清单和更新通道使用工作流解析出的冻结提交。
3. 在提交前运行根目录 `npm test`，并执行相关服务／客户端检查。提交、推送后，手动运行 **Release TuneFlow together**，`source_ref` 填完整 SHA，保持 `publish=false`，可先验证整批构建。该流程不安装依赖到同一个共享运行时，各端保持独立工具链。
4. 冻结确认后创建并推送 `TuneFlow-v<version>` 标签，标签指向同一提交。在该标签上运行统一工作流，`source_ref` 使用同一 SHA，设置 `publish=true`。流程同时核对标签名、标签指向、仓库及三端版本，其他标签或错误源码不会发布。
5. 配置仓库变量 `DOCKERHUB_USERNAME` 和 secret `DOCKERHUB_TOKEN`，不把凭据写入源码。只有全部客户端和镜像构建成功后，发布任务才登录 Docker Hub。镜像版本为 `<version>`，源码标签为 `sha-<冻结 SHA 前 12 位>`；客户端标签为 `TuneFlow-v<version>`。

发布阶段直接下载本次运行的原始构建附件和已通过健康／存储检查的镜像，不再次构建。发布前检查全部八个客户端包；镜像内的版本与源码标签也必须匹配。客户端仍为六个桌面包、arm64-v8a 和 universal 两个 Android APK，附两组清单与校验文件。Docker 内置 Web 保留，无独立 Web 包或服务端 GitHub Release。

Docker Hub 和 GitHub 不支持跨平台原子事务。流程先上传版本和源码镜像，再公开客户端、更新客户端通道，最后推进 Docker `latest`；`docker-publication.json` 作为 Actions 附件保留镜像摘要。如果发布中途失败，检查已上传状态，仅重跑同一运行中失败的任务，复用原附件；不要重新构建覆盖同版本附件、移动标签或删除用户数据。相同镜像允许继续，不同内容会阻止覆盖。若客户端步骤失败，Docker 版本标签可能已存在，`latest` 尚未推进；若最终 `latest` 推进失败，客户端可能已经公开，应重试该发布任务并核对结果。流程失败不等于已经发布完整版本。

本轮验证只运行本地策略／发布模拟测试和 Actions 静态检查，不触发实际发布；新编排的首次真实运行仍需在下一版记录结果。

## 仅发布 Docker

`Release TuneFlow together` 增加显式的 `docker_only` 布尔输入，默认 `false`，保留完整发布行为。需要仅发布服务与内置 Web 时，使用相同的版本／标签／冻结 SHA 校验，设置 `docker_only=true` 和 `publish=true`。客户端构建、附件发布、Release 和更新通道步骤均跳过；只有镜像构建、健康、存储及密码初始化／重启测试通过后才推送版本镜像和 `latest`。

源码仍按现有策略统一版本，但这不表示桌面或 Android 安装包已发布。Docker-only 版本不创建客户端 Release，也不修改已公开的客户端通道。发布后核对版本、源码与 `latest` 的镜像摘要，并在部署目标验证实际运行的镜像及持久挂载。
