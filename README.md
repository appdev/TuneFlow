# TuneFlow

TuneFlow 服务端、桌面/Web 和 Android 源码在同一仓库维护；各应用独立安装依赖、构建和发布。

| 目录 | 用途 |
| --- | --- |
| apps/service | Node.js 服务与过渡期旧 Web；Docker 默认入口保持旧 Web |
| apps/player | Electron 桌面与共享 Vue Web，Web 适配层位于 src/web-runtime |
| apps/android | React Native Android 客户端 |
| packages/service-client | 可移植的 API、DTO、超时和安全地址规则 |
| packages/music-core | 跨端下载、推荐及账号歌单等业务规则 |

Flutter 不在此次迁移范围。旧客户端仓库继续保留历史 Release 和更新地址。

## 安装与构建

使用 Node 24 构建服务与桌面/Web，Android 发布流水线使用 Node 22、JDK 21 与原 SDK 配置。分别运行 `npm ci --prefix apps/service`、`npm ci --prefix apps/player`、`npm ci --prefix apps/android`。根目录不启用依赖提升，避免 Node、Electron 和 React Native 的原生依赖互相覆盖。

- `npm run build:service`：旧 Web 与独立服务，输出 apps/service/dist。
- `npm run build:player`：桌面生产代码；`npm run pack:player -- darwin-arm64` 打包对应目标。
- `npm run build:web:qmusic`：共享 Vue Web 加 /V2/ 兼容入口，输出 apps/service/dist/web-qmusic。
- `npm run build:android -- -PreactNativeArchitectures=arm64-v8a`：独立预览 APK。
- `npm test`、`npm run test:contract` 与各应用测试验证边界和业务契约。

根目录 Dockerfile/compose.yaml 继续使用同一服务名、端口、卷和默认 Web。迁移源码不移动音乐、配置、歌单、账号资料或任何运行目录；新构建输出不会覆盖根目录保留的旧 dist。

## 发布兼容

服务端维持独立版本和 Docker 发布；桌面/Web、Android 可独立构建和分批发布。原应用 ID、profile、签名配置及存储键不变。Q-music 更新线路继续使用原仓库与资产命名，旧安装无需卸载。发布兼容入口及迁移说明见 docs/monorepo.md。
