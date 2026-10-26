# TuneFlow 桌面与 Web 客户端

本目录是 TuneFlow 的 Electron 桌面客户端和共享 Vue Web 源码。Server 与 Android 已在同一仓库维护，不再依赖相邻的独立源码仓库。

[产品首页](../../README.md) · [客户端下载安装](https://github.com/appdev/Q-music/releases) · [问题反馈](https://github.com/appdev/TuneFlow/issues) · [Android](../android/README.md)

## 共享 Web 界面预览

![共享 Vue Web 首页与推荐](../../docs/images/web-home.png)

![共享 Vue Web 歌单列表](../../docs/images/web-playlist.png)

以上为浏览器实际截图，使用隔离示例数据；桌面复用同一套 Vue 页面，并通过 Electron 提供原生能力。[截图版本与来源](../../docs/images/README.md)。

## 在产品中的位置

- Server 管理音乐库、歌单、收藏、历史、音源、解析与下载；客户端负责界面和播放。
- Docker 默认 Web 复用本目录的 Vue 页面，浏览器适配层位于 `src/web-runtime`。
- Web 固定连接页面所在服务；桌面可选择服务地址。共享业务默认与 Android 一致，桌面歌词、全局快捷键等使用原生适配器。
- 音乐库指连接的服务所管理的音乐，不把原电脑文件自动上传或迁移。数据归属见[统一客户端说明](README-service.md)。

## 下载与更新兼容

客户端附件与应用内更新继续使用 [appdev/Q-music Releases](https://github.com/appdev/Q-music/releases)，源码、Issue 和 PR 则统一在 [appdev/TuneFlow](https://github.com/appdev/TuneFlow)。

现有附件仍使用 `Q-music-Docker-<version>-<platform>-<arch>` 名称。桌面预览身份为 `io.github.qmusic.docker.preview`，profile 为 `q-music-docker-preview`；不要将旧上游 Q-music 安装包与此兼容通道混用。覆盖升级须保留应用身份、数据目录和原签名兼容性。发行包是否签名、公证及系统验证范围，以对应 Release 说明为准。

| 构建目标 | 兼容通道归档 |
| --- | --- |
| `darwin-arm64` / `darwin-x64` | macOS ZIP |
| `win32-x64` / `win32-arm64` | Windows ZIP |
| `linux-x64` / `linux-arm64` | Linux tar.gz |

## 开发与构建

以下命令在 **TuneFlow 仓库根目录** 执行，使用 Node.js 24。Electron 原生模块与 Service 的 Node 原生模块分别安装和打包。

```sh
npm ci --prefix apps/player
npm run build:player
Q_PREVIEW_OUTPUT_ROOT=artifacts/release npm run pack:player -- darwin-arm64
```

将目标替换为上表中的其他值；构建依赖目标平台的可用原生绑定，跨平台打包通过不代表已在对应系统实机验收。上例归档输出到 `apps/player/artifacts/release/<target>/`。

开发模式：`npm --prefix apps/player run dev`。请先准备可连接的 Server，客户端不会在断线后悄悄改用旧本地数据库。

## Web 构建

```sh
npm --prefix apps/player run build:web
```

独立静态产物为 `apps/player/dist/web-client`。若需要与 Server 和旧 `/V2/` 页面配套使用，运行根命令 `npm run build:web:qmusic`；需同时安装 Service 依赖。

Web 的同源约束、平台能力与隔离测试见 [Web 说明](../service/docs/qmusic-web.md)。生成静态产物不会自动部署或发布。

## 验证

```sh
npm run test:player
npm --prefix apps/player run test:web
# 需安装 Service 依赖并准备运行时
npm run prepare:service
npm run test:contract
```

各端版本和发布流水线见[单仓库说明](../../docs/monorepo.md)。更新镜像配置见[更新线路说明](docs/update-mirrors.md)。

## 上游与许可

本客户端基于 [Q-music](https://github.com/Nshpiter/Q-music) 和 [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) 修改，是独立衍生版本，不代表上游官方发布或背书。

保留 [Apache License 2.0](LICENSE)、[NOTICE](NOTICE)、[二次修改记录](MODIFICATIONS.md) 和[原项目协议与免责声明](../service/README.md#project-agreement)。第三方音乐、歌词与封面版权归原权利人所有。
