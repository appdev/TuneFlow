# 多平台构建与发布检查

检查日期：2026-10-26。服务端源码版本 `2.13.7`；桌面、Web、Android 源码版本 `0.4.25`。版本提交、构建成功和公开发布是不同状态。

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
- 当前 GitHub API 对 `appdev/Q-music` 返回 404。可能是仓库已删除、改名或当前凭据无法访问；无法确认旧更新通道可用，也无法验证其中的兼容调用器。`appdev/TuneFlow-Client` 是独立 Flutter 仓库，不能直接替换该通道。
- TuneFlow 中已配置 Docker Hub 用户变量和令牌名称；未读取令牌值。它们的存在不等于本次已完成推送验证。

结论：已有跨平台预览包构建能力，但当前不能宣称具备完整、可用的端到端多平台发布链路。客户端兼容仓库访问是发布阻塞，服务镜像缺少 arm64，正式签名与公证也未覆盖。

## 触发方式

- [客户端 Action](../.github/workflows/release-client.yml)：PR 检查，或手动指定不可变 `source_ref`，按 `all`、`desktop`、`web`、`android` 构建。TuneFlow 直接手动运行只上传构建附件，不公开发布。
- 客户端公开发布必须从 `appdev/Q-music` 的兼容调用器传入 `publish=true`。所有选中构建与验证成功后，发布脚本核对附件完整性、计算 SHA-256、拒绝覆盖不同内容的已有附件，最后更新旧通道元数据。恢复仓库访问前不要改写旧客户端的更新地址。
- [Docker Action](../.github/workflows/docker-build.yml)：PR 仅构建检查；手动 `push_image=true` 才推镜像。`publish_release=true` 还要求运行在与服务版本一致的 `v<version>` 标签，且有对应发布说明。
- [共享检查](../.github/workflows/monorepo-checks.yml) 和 [服务检查](../.github/workflows/build-test.yml) 当前仅由 PR 或手动触发。
- 当前配置不会因向 `main` 推送提交或创建标签而自动启动构建／发布；需要另行手动运行。不要把“代码已推送”表述为“新版本已发布”。

## 下次公开发布前

1. 恢复或确认旧客户端发布仓库的访问及兼容调用器，核对现有安装包和更新元数据；如需迁移通道，先制定旧版可升级的过渡方案。
2. 在冻结提交上运行所需构建和共享契约检查，确认版本、Android versionCode、应用 ID、签名及现有数据兼容。
3. 服务端先建立与版本匹配的不可变标签，再运行健康检查与镜像发布；若需要 ARM 服务器，先增加并验证 arm64 构建及运行能力。
4. 发布后独立核对附件清单、摘要、公开更新元数据及镜像摘要。正式签名／公证和商店上架需要另外配置，不能从预览包构建成功推断。
