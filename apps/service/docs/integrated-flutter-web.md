# 本地 Flutter Web 与 Service 集成

> 历史可选集成记录。Flutter 为独立外部项目，不属于本仓库的客户端构建范围；本文保留早期集成与验收过程，旧目录和命令不应作为当前单仓库的部署入口。当前 Docker 默认使用共享 Vue Web，新部署请参阅[产品首页](../../../README.md)与[共享 Web 说明](qmusic-web.md)。

## 入口与构建

在 Service 仓库执行：

```sh
npm run build:web:integrated -- /Volumes/ext/MusicFree/flutter-client
npm run build:server
```

构建产物为 `dist/web-integrated`：Flutter 位于 `/`，原 Vue 客户端位于
`/V2/`（使用 `/V2/#/...` 路由）。`/V2` 会重定向到 `/V2/`。
Vue 的分包、图片和样式使用 `/V2/` 资源前缀；两套前端共享根路径的
`/api/v1/` 接口。Flutter Web 固定连接页面所在 origin，不自动切换到
Service 为原生客户端公布的 LAN / 外网地址。

Flutter 构建使用 `--no-web-resources-cdn`，CanvasKit 随站点本地提供。
这不代表第三方歌曲、封面或字体回退资源完全不需要外网。

构建先写入临时目录，成功后切换；已有整合产物重命名为
`dist/web-integrated-backup-<timestamp>`，原 `dist/web` 不会被覆盖。
本地静态站点构建不会启动或替换容器；Docker 整合入口见下节。

## 单容器 Docker 构建与运行

整合镜像仍然只有一个 Node Service 进程，监听 `3124`：它同时提供
Flutter 静态页面、旧版 `/V2/` 和 `/api/v1/`。不需要 Nginx、Flutter SDK
或另一个前端开发服务器进驻运行时镜像。

在 Service 仓库执行（需要本机 Flutter、Node/npm、可用的 Docker daemon 和 Compose）：

```sh
# 编译当前 Flutter 和旧版 /V2/，然后构建同一个 Service 镜像；不会自动部署。
npm run build:docker:integrated -- /Volumes/ext/MusicFree/flutter-client

# 如已完成上文 build:web:integrated，可直接复用整合产物，避免重复编译：
npm run build:docker:integrated -- --skip-web-build

# 上面二选一，成功后再启动或更新容器。
docker compose -f compose.yaml -f compose.integrated.yaml up -d --no-build
```

复用模式不检查 Flutter 源码新旧；修改客户端后应重新构建 Web。
构建入口会先检查 Docker，再执行耗时编译。缺少 Flutter、`/V2/` 资源，
或 Flutter 的 base href 不是 `/` 时会明确失败，不会悄悄打包旧版首页。
启动前确认本机 `3124` 没有被之前的本地 Node 测试实例占用。

`compose.integrated.yaml` 只向原 `tuneflow-web` 服务传入
`TUNEFLOW_WEB_VARIANT=integrated`，不会增加另一个容器，也不会修改
`/music`、`/config` 的挂载、端口、健康检查及非 root 运行方式。
保持在同一个 Compose 项目下执行，以复用原有配置卷；不要使用 `down -v`。

整合构建仅将 `dist/web-integrated` 静态产物加入 Docker 上下文；本机
`dist/server`、依赖、其他构建产物和备份仍被排除。Service 及其 SQLite
等原生依赖始终在 Linux 构建阶段重新编译，避免把 macOS 二进制装进镜像。
容器内使用统一的 `/app/dist/web`，不是挂载宿主机 Flutter 构建目录。

原来的 `docker compose build` 和现有 CI 默认仍构建 legacy 版本，以保持
单独检出 Service 仓库时的兼容性；要得到 Flutter 默认首页，必须使用整合入口。
本次只修改并验证构建脚本，没有发布镜像或更新远端容器。

## 启动隔离测试实例

要求已安装项目依赖及适配当前 Node 的原生 SQLite 模块。不要将测试实例
指向 NAS/生产媒体库。启动命令在 Service 仓库运行：

```sh
test_storage=$(mktemp -d /tmp/tuneflow-local-web-XXXXXX)
TUNEFLOW_STORAGE_ROOT="$test_storage" \
TUNEFLOW_WEB_ROOT="$PWD/dist/web-integrated" \
TUNEFLOW_SERVICE_NODE_MODULES="$PWD/node_modules" \
TUNEFLOW_HOST=127.0.0.1 TUNEFLOW_PORT=3124 \
node dist/server/index.cjs
```

打开 `http://127.0.0.1:3124/`，无需另启 Flutter 静态服务器。
旧版入口为 `http://127.0.0.1:3124/V2/`。停止测试进程后，可将
`TUNEFLOW_WEB_ROOT` 改回未动过的 `dist/web`，或指定保留的整合备份目录。
无需删除或迁移测试数据库。

## 文件能力与测试边界

| 能力 | Web 行为 |
| --- | --- |
| 本地音源导入 | 浏览器文件选择器读取 UTF-8 `.js` 文件并提交到 Service |
| 音源导出 | 浏览器下载 ZIP；空音源列表禁用导出 |
| ZIP 恢复 | 当前导入只接受 `.js`，需要先解压；没有直接导入 ZIP 的入口 |
| 歌曲下载 | 创建 Service 下载任务，文件写入 Server 媒体目录，不是浏览器设备的下载目录 |
| 下载文件播放 | 浏览器通过同源 Service 音频接口播放，仍需连接 Service |
| 本机缓存设置 | Web 隐藏原生音频缓存上限及清理操作，显示浏览器存储说明 |
| 歌单文件导入/导出 | Flutter 目前没有对应文件入口，不能视为已验证或已实现 |

2026-09-05 的本地验证使用全新测试库、真实 Service API 和项目自带的静音
MP3，没有模拟 Service API，也没有复制真实用户音源或媒体数据。音源文件位于
Flutter 仓库 `test/fixtures/web_source.js`，仅供本地测试，返回
`http://127.0.0.1:8790/test-audio.mp3`。

当使用该回环音频测试夹具时，本次测试进程额外设置
`NODE_ENV=test TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS=1`。
这是仓库已有的测试开关，不能用于正式启动或部署；正式网络限制未修改。
测试库的 MusicBrainz 地址设为空，避免推荐查询干扰本地文件能力验证。

本轮保留的本地运行实例使用 `/tmp/tuneflow-integrated-test-5ncgEq`。
测试音源上游位于同目录的 `browser-fixtures`，仅绑定 `127.0.0.1:8790`；
实际下载文件位于其 `audio` 子目录。该目录不是正式数据目录，系统可能清理 `/tmp`。

实测完成：文件选择器导入、启用音源、ZIP 下载及脚本内容对比、播放器创建下载
任务、任务完成与媒体文件落盘、音频解码内容对比、浏览器播放与暂停。
下载会写入标签，因此文件整体哈希可变；解码后的 PCM SHA-256 与原测试音频相同。
测试音源不提供封面与歌词，第三方补全失败不代表音频下载或浏览器播放器失败。

重点回归命令：

```sh
# Flutter 仓库
flutter test --platform chrome test/web/file_capabilities_test.dart test/web/window_frame_test.dart
flutter test test/features/connection/endpoint_selector_test.dart test/features/connection/connection_controller_test.dart
flutter test test/features/sources/sources_screen_test.dart test/features/sources/sources_controller_test.dart
flutter test test/features/settings/settings_screen_test.dart test/features/downloads/downloads_screen_test.dart

# Service 仓库
npx vitest run src/server/app.test.ts -t 'serves Flutter at root'
npx vitest run src/server/routes/sources-export.test.ts
```

本轮使用 Chromium 验证桌面和窄屏布局，不等同于已验证 Safari、Firefox、
真实 iOS/Android 浏览器，或第三方音源与实际歌曲可用性。
