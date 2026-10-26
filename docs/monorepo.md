# 单仓库结构与发布兼容

[产品首页](../README.md) · [Server](../apps/service/README.md) · [桌面/Web](../apps/player/README.md) · [Android](../apps/android/README.md)

## 一个产品，独立运行边界

TuneFlow 是主源码仓库。服务、桌面/Web 与 Android 在同一个 Git 历史中维护，各应用仍独立安装依赖、构建、版本管理与发布，不把所有原生运行时合并为一套依赖。

| 目录 | 边界 |
| --- | --- |
| `apps/service` | Node Service、SQLite、音源执行、下载、音乐库与兼容旧 Web |
| `apps/player` | Electron 与共享 Vue 页面；`src/web-runtime` 提供浏览器适配 |
| `apps/android` | React Native 与 Android 平台适配 |
| `packages/service-client` | API、DTO、超时、地址与资源安全规则 |
| `packages/music-core` | 跨端下载、推荐、歌单等可移植业务规则 |

共享业务不应依赖 Vue、React、Electron 或服务端数据库；界面、平台会话、系统权限和存储适配留在对应应用。Flutter 是独立项目，不由本仓库安装或构建。

历史导入基线为 Service `9f4dcdbd`、桌面/Web `50de9ca4`、Android `8f85b4c4`。subtree 导入未 squash，可通过 Git 历史追溯来源；旧分仓目录不再是开发入口。

## 运行与数据

Server 管理歌单、收藏、历史、音源、下载与音乐文件；客户端连接同一服务即可使用这些共享数据。界面按业务组织，不把服务和客户端呈现为两个产品。

Docker 默认托管 `apps/player` 的共享 Vue Web。Web 固定连接页面 origin，隐藏服务器切换设置；旧地址不能覆盖该绑定。桌面与 Android 保留连接选择。旧 Web 在 `/V2/`，构建参数 `TUNEFLOW_WEB_VARIANT=legacy` 可选择兼容旧前端。

配置卷与音乐目录保持原挂载；源码目录调整不会迁移或清空用户数据。外观、输出、临时队列等设备偏好保持各自存储。账号官方授权与会话按对应版本的平台适配器处理，不把歌单同步当作另一设备已完成授权。

## 保持的安装与更新身份

| 项目 | 兼容约定 |
| --- | --- |
| 桌面预览 appId / profile | `io.github.qmusic.docker.preview` / `q-music-docker-preview` |
| Android 预览 applicationId | `io.github.nshpiter.qmusic.mobile.preview` |
| Android 正式 applicationId | `io.github.nshpiter.qmusic.mobile`；正式与预览签名分别保留 |
| 桌面连接键 | `qmusic.docker.endpoint.v1` |
| Android 连接键 | `qmusic.service.endpoint.v1` |
| 客户端发布入口 | [appdev/Q-music Releases](https://github.com/appdev/Q-music/releases)，保留资产命名与更新元数据 |
| Server 发布入口 | [appdev/TuneFlow Releases](https://github.com/appdev/TuneFlow/releases)，独立版本与 Docker 镜像 |

源码统一不意味着修改应用 ID、重建签名、卸载重装或重定向旧更新地址。旧 Release 和安装资产保留，不覆盖已公开的不同内容。

## 构建与发布入口

| 工作流 | 作用 |
| --- | --- |
| [Shared contracts and client checks](../.github/workflows/monorepo-checks.yml) | 单仓库约束、共享契约与客户端检查 |
| [Docker build](../.github/workflows/docker-build.yml) | 构建并检查 `linux/amd64` 服务镜像；可手动选择推送镜像与发布服务版本 |
| [Build and release clients from monorepo](../.github/workflows/release-client.yml) | 按 `desktop`、`web`、`android` 或 `all` 独立构建客户端 |
| [兼容发布调用器](https://github.com/appdev/Q-music/blob/master/.github/workflows/tuneflow-client.yml) | 在原发布仓库调用 TuneFlow 构建，并按需发布到原客户端通道 |

当前通道可用性、产物覆盖和手动触发要求见[多平台发布检查](release-readiness.md)。版本提交不代表安装包或镜像已经发布。

客户端工作流先解析 `source_ref`，后续任务只检出同一固定 SHA。直接在 TuneFlow 手动运行客户端工作流只构建和上传 Actions artifacts；发布到现有更新通道须使用兼容调用器并选择 `publish`。构建所用源码仍来自 TuneFlow。

所选端安装包与校验文件完整上传后，才更新旧仓库公开的版本元数据；API、raw 与 CDN 回退线路保留，更新通道不能降回旧版本。服务端发布从 `apps/service/package.json` 读取版本；发布服务 Release 时工作流要求匹配的 `v<version>` tag 与发行说明。服务与客户端版本不要求相同，`all` 客户端发布要求桌面和 Android 版本匹配。

公开下载使用 Release 列表链接，兼容通道可能只有预发行版，`/releases/latest` 不一定可用。发布凭据与签名配置留在实际运行工作流的仓库，不写入源码或文档。

## 验证与回退

根命令见 [README](../README.md#验证与贡献)。共享行为变更应覆盖各端实际适配器与 Service 契约；桌面/Web 和 Android 各自构建，原生绑定匹配对应运行时。真实账号登录由本人完成，自动化使用隔离合成数据。

源码可以切回历史提交；镜像升级保留旧镜像、原 Compose 与持久挂载。前端的 `/V2/` 是兼容入口，不等于完整部署备份。回退不应删除配置卷、音乐目录或客户端数据。
