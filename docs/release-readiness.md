# 多平台构建与发布检查

检查日期：2026-10-26。服务端源码版本 `2.13.8`；桌面、Web、Android 源码版本 `0.4.26`。版本提交、构建成功和公开发布是不同状态。

## 能力与边界

| 产物 | 当前 Actions 能力 | 发布条件／限制 |
| --- | --- | --- |
| macOS | x64、arm64 ZIP | 预览通道，临时签名、未公证，不是正式签名安装器 |
| Windows | x64、arm64 ZIP | 未签名便携版，无应用内自动安装更新 |
| Linux 桌面 | x64、arm64 tar.gz | 便携包，不包含该流程未配置的 deb、rpm 等安装包 |
| Web | 主界面与 `/V2/` 的 tar.gz | 独立下载包，也随服务镜像提供；构建不等于部署 |
| Android | arm64-v8a、armeabi-v7a、x86、x86_64、通用 APK | 沿用 `.preview` 应用 ID 与原预览签名，覆盖升级；不属于应用商店正式签名包 |
| 服务端 Docker | `linux/amd64` | 健康、配置／音乐存储检查后，可手动推送镜像和发布 Release；尚无 arm64 镜像构建验证 |

此仓库没有 iOS 发布流程。独立 Flutter 项目不属于本次发布矩阵。

## 实际检查结果

- [客户端构建 run 40262806341](https://github.com/appdev/TuneFlow/actions/runs/40262806341)：版本元数据、验证、六个桌面目标、Web、Android 均成功，`publish` 跳过。它证明当时源码的打包能力，不代表本次版本已经构建或发布。
- [Docker run 40257488152](https://github.com/appdev/TuneFlow/actions/runs/40257488152)：构建、健康和存储检查成功；镜像推送与发布未执行。
- 用户确认原 Q-music 发布仓库已删除。当前源码将客户端发布、下载及 API／raw／CDN 更新线路统一迁移到 TuneFlow，使用 `TuneFlow-v<version>` 标签；不再需要旧仓库调用器。`appdev/TuneFlow-Client` 是独立 Flutter 仓库，不参与发布。
- TuneFlow 中已配置 Docker Hub 用户变量和令牌名称；未读取令牌值。它们的存在不等于本次已完成推送验证。

结论：已有跨平台预览包构建能力，源码已解除对旧发布仓库的依赖。新仓库的首次公开客户端发布仍需实际运行确认，不能将离线测试等同于公开发布成功。服务镜像缺少 arm64，正式签名与公证也未覆盖。

## 触发方式

- [客户端 Action](../.github/workflows/release-client.yml)：PR 检查，或手动指定不可变 `source_ref`，按 `all`、`desktop`、`web`、`android` 构建。默认只上传构建附件；选择 `publish=true` 后直接在 TuneFlow 发布预览版。
- 所有选中构建与验证成功后，发布脚本核对附件完整性、计算 SHA-256、拒绝覆盖不同内容的已有附件，再核对已公开附件的摘要和大小，最后创建或更新 `main` 分支的 `channels/desktop.json`、`channels/android.json`。这些文件只在发布成功后写入，客户端不读取源码中待发布的版本文件。服务端 `v<version>` 和独立 Web 附件不会被误识别为客户端更新。
- [Docker Action](../.github/workflows/docker-build.yml)：PR 仅构建检查；手动 `push_image=true` 才推镜像。`publish_release=true` 还要求运行在与服务版本一致的 `v<version>` 标签，且有对应发布说明。
- [共享检查](../.github/workflows/monorepo-checks.yml) 和 [服务检查](../.github/workflows/build-test.yml) 当前仅由 PR 或手动触发。
- 当前配置不会因向 `main` 推送提交或创建标签而自动启动构建／发布；需要另行手动运行。不要把“代码已推送”表述为“新版本已发布”。

## 下次公开发布前

1. 原发布仓库已删除，旧版无法从旧地址收到升级。首次迁移需要手动下载新仓库的预览包，保留应用 ID、预览签名及原数据目录覆盖安装；不能保证以不同签名或应用 ID 安装的版本可覆盖升级。
2. 在冻结提交上运行所需构建和共享契约检查，确认版本、Android versionCode、应用 ID、签名及现有数据兼容。
3. 服务端先建立与版本匹配的不可变标签，再运行健康检查与镜像发布；若需要 ARM 服务器，先增加并验证 arm64 构建及运行能力。
4. 发布后独立核对附件清单、摘要、公开更新元数据及镜像摘要。正式签名／公证和商店上架需要另外配置，不能从预览包构建成功推断。
