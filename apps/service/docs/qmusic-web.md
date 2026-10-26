# 共享 Web：默认界面、构建与能力

[产品首页](../../../README.md) · [桌面/Web 源码](../../player/README.md) · [Server 部署与存储](server-web.md)

Docker 默认 Web 使用 `apps/player` 的 Vue 页面，与桌面复用界面和业务适配器。Server 同时提供静态资源与 `/api/v1/`；不需要额外启动 Electron 或前端开发服务器。旧 Web 保留在 `/V2/`。

## 同源与能力边界

Web 固定连接当前页面的 origin，隐藏服务器切换设置；既不使用桌面记住的内网地址，也不能通过保存其他地址改变该绑定。

| 功能 | Web 行为 |
| --- | --- |
| 歌单、收藏、历史、音乐库 | 使用当前 Server 的数据；音乐库是服务管理的媒体目录 |
| 搜索、榜单、歌单广场、推荐 | Service API；平台精选与可用的个人推荐优先，通用推荐回退 |
| 播放与跨平台容错 | 服务解析、匹配与切换；浏览器播放同源音频流 |
| 下载、边听边存与任务管理 | 服务执行，完成后进入音乐库；移除任务记录保留文件 |
| 删除音乐文件 | 独立的媒体管理操作，与移除任务记录区分 |
| 音源、解析顺序、下载设置 | 共享服务配置；不能通过浏览器修改宿主机挂载路径 |
| 外观、音量、音质、队列与恢复 | 浏览器偏好，不覆盖原生客户端存储 |
| 平台官方登录 | 已发布基线由桌面/Android 官方授权；账号歌单导入后可在 Web 使用，后续账号能力以对应版本发行说明为准 |
| 桌面歌词、窗口/托盘、全局快捷键、原生文件路径操作 | 浏览器不具备对应原生能力，隐藏入口或说明限制 |

首页普通导航及返回已加载来源复用快照；主动换批、账号/连接变化、跨日或缓存过期时更新。宽屏使用居中内容布局，两侧与内容区共用连续的主题背景。

普通 HTTP 页面可能不具备 `mediaDevices`、AudioWorklet 等安全上下文 API；浏览器的格式支持、自动播放和后台播放政策仍然生效。客户端特有能力不能以空操作模拟成功。

## 构建与源码运行

以下命令均在 **TuneFlow 仓库根目录** 执行，使用 Node.js 24：

```sh
npm ci --prefix apps/player
npm ci --prefix apps/service
npm run build:web:qmusic
npm run prepare:service
TUNEFLOW_WEB_ROOT="$PWD/apps/service/dist/web-qmusic" npm run start:server
```

组合产物为 `apps/service/dist/web-qmusic`：共享 Web 在 `/`，兼容旧 Web 在 `/V2/`。构建使用 staging，已有同名产物保留为时间戳备份；不会启动或替换容器。

只构建共享页面可运行 `npm --prefix apps/player run build:web`，输出 `apps/player/dist/web-client`；该独立产物不包含旧 `/V2/`。根命令 `npm run build:service` 构建的是旧 Web 与服务，不能替代共享页面组合构建。

## Docker 默认构建与可选覆盖

根目录 [Dockerfile](../../../Dockerfile) 默认构建共享 Web 与 `/V2/`：

```sh
docker compose up -d --build
```

新默认界面不再需要额外前端覆盖文件。旧版兼容镜像可通过 `docker build --build-arg TUNEFLOW_WEB_VARIANT=legacy -t tuneflow:legacy .` 构建；切换实例前保留旧镜像、配置与挂载。

[compose.qmusic-web.yaml](../../../compose.qmusic-web.yaml) 仍可用于测试独立静态产物：只读挂载 `Q_MUSIC_WEB_ROOT` 到现有容器并覆盖静态根目录。它是可选调试入口，不是新默认界面的安装前提。

```sh
Q_MUSIC_WEB_ROOT=/absolute/server/path/web-qmusic \
docker compose -f compose.yaml -f compose.qmusic-web.yaml up -d
```

移除覆盖时恢复原 Compose 并保留配置卷与音乐目录，不执行 `down -v`。`/V2/` 不包含部署镜像、数据或可能使用过的外部 Flutter 前端备份。旧 Server 也应与 Web 使用兼容版本，单独换静态资源不能补上后端接口修复。

## 隔离测试

以下命令仍在仓库根目录执行。先完成上述构建，并准备 Playwright Chromium 和本机 FFmpeg；FFmpeg 只用于生成合成测试音频，不是正式服务依赖。

```sh
npm --prefix apps/player run test:web
Q_WEB_ROOT="$PWD/apps/service/dist/web-qmusic" node apps/player/scripts/web-service-fixture.cjs
# 另一个终端
node apps/player/scripts/verify-web-client.cjs
```

夹具只监听回环地址，使用独立临时数据库、合成歌单/音频和确定性上游；默认测试记录在 `apps/player/artifacts/web-client/verification/`。测试专用网络例外只允许用于该测试进程，不能带入正式环境。Chromium 自动化通过不代表其他浏览器、实体手机或第三方真实账号已验收。
