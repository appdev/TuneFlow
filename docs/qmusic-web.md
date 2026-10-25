# Q-music Web 测试与默认前端候选

当前 Q-music 客户端新增独立浏览器构建，复用桌面 Vue 页面和 Service 业务适配器。Electron 与 Android 的平台账号和现有数据不做迁移。

## 构建

```sh
npm run build:web:qmusic -- /path/to/qmusic-desktop
npm run build:server
```

产物为 `dist/web-qmusic`：Q-music 位于 `/`，本仓库原 Vue Web 位于 `/V2/`，API 仍为 `/api/v1/`。构建先写入 staging，完成后发布到该独立目录；已有同名产物保留为时间戳备份。不会覆盖 `dist/web`、Flutter 产物、原生客户端包或启动/更新容器。

桌面仓库也可单独运行 `npm run build:web`，输出 `dist/web-client`。两种入口使用相同 Web 构建配置，默认同源连接当前页面的 Service，不使用原生客户端记住的 LAN 地址。

## 能力边界

| 功能 | Web 行为 |
| --- | --- |
| 音乐库、歌单、收藏、历史 | 使用当前 Service；音乐库指 Docker 中的音乐 |
| 搜索、歌单广场、排行榜、推荐 | Service API；首页支持所选平台的公开精选，通用推荐作为回退，支持换批与更新通知 |
| 播放、跨平台容错 | 由 Service 解析和切换，浏览器播放同源音频流 |
| 下载、暂停、继续、移除记录 | 在 Service 执行，文件保存在服务器媒体目录；移除记录保留文件 |
| 音源文件/地址导入、启用顺序 | 统一服务器设置 |
| 下载设置 | 服务器共享；保存目录只读，不能从浏览器改变挂载路径 |
| 外观、音量、音质、队列、播放恢复 | 独立浏览器存储，不覆盖原生客户端或共享设置 |
| 官方平台账号登录、账号个人推荐 | 使用桌面端或 Android；Web 明示边界，不接收/上传账号凭证 |
| 已导入的账号歌单 | 已在 Service 中保存，可直接从 Web 使用 |
| 桌面歌词、窗口控制、全局快捷键、原生音效和本机文件路径操作 | Web 隐藏或明确提示，不模拟成功 |

普通 HTTP 局域网页面可能没有 `mediaDevices`、AudioWorklet 等安全上下文 API；默认音频输出仍可播放。浏览器自身的格式、自动播放及后台播放政策仍然生效。

首页普通导航及返回已加载来源复用快照；主动换批、账号或连接变化、跨日和缓存过期才重新获取。界面统一使用“推荐”等业务名称。公开精选使用已有歌单浏览/详情接口，无需登录或新增后端接口。

本次同时修复 Service 的两个兼容问题：不完整酷我歌单标签在进入 SDK 前返回 400；下载接受只有公开音质列表、没有 SDK 私有音质映射的歌曲。正式替换前应使用包含这些修复的 Service 构建，仅替换静态文件不能修复旧后端。

## 隔离测试

在桌面仓库运行以下命令。测试依赖相邻 Service 已构建的运行时、Playwright Chromium，以及本机 FFmpeg（只用于生成合成测试音频，不是正式 Service/Web 运行依赖）。

```sh
npm run test:web
Q_WEB_ROOT=/path/to/TuneFlow/dist/web-qmusic node scripts/web-service-fixture.cjs
# 另一个终端
node scripts/verify-web-client.cjs
```

夹具只监听回环地址，使用独立临时数据库、合成歌单/音频和确定性平台上游。测试安全例外仅限这个测试进程，不写入生产环境。浏览器检查包含实际 Service API、音频播放、服务器下载及文件保留；没有模拟 Service API。

测试入口与证据保存在桌面仓库 `artifacts/web-client/verification/`。报告中的 `httpLan` 使用 Chromium 主机映射指向回环服务，验证非安全 HTTP 上下文，不需要公开测试服务。测试 URL 来自 `fixture.json`，临时夹具停止后该地址失效。其他浏览器、实际手机浏览器及第三方平台真实账号不因 Chromium 检查而视为通过。

## 可回退的 Docker 切换方式

`compose.qmusic-web.yaml` 是显式选择的静态目录覆盖；默认 Compose 不变。它只将已构建静态目录只读挂载到现有 Service 容器，并设置 `TUNEFLOW_WEB_ROOT`，不会添加后台进程或改变 `/config`、`/music` 的挂载。

部署前备份当前镜像、Compose 配置和实际默认 Web 产物，再将新静态目录放到部署主机；需要更新 Service 镜像以包含上面的兼容修复。在原 Compose 项目中使用：

```sh
Q_MUSIC_WEB_ROOT=/absolute/server/path/web-qmusic \
docker compose -f compose.yaml -f compose.qmusic-web.yaml up -d
```

回退时恢复原镜像/Compose 并去掉该覆盖文件，重新启动同一个服务；保留配置卷和音乐目录，不执行 `down -v`。`/V2/` 是本仓库原 Vue Web 的备用入口，不应把它视为已经备份了线上可能不同的 Flutter/其他默认页面。

源码和本地构建完成不代表已部署。切换 Docker 默认前端需要单独执行上述部署步骤；配置卷和音乐目录应始终保留。
