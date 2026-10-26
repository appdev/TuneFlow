# Q-music 统一 Docker 客户端 · 桌面版

当前 Mac ARM64 验证包：0.4.23-service.10。后台继续使用现有 Service / Docker，默认地址为 `http://192.168.0.70:3124`。其他平台包的版本和验证范围见各自构建记录。

## 功能归属

桌面、Web 和 Android 默认提供相同业务功能，共用 Docker 服务。新增功能和修复须同时检查三端；仅平台无法支持的能力保留明确说明。

界面统一使用音乐库、推荐、下载和设置等名称，不再按 Docker 与设备拆分入口。未登录时优先展示所选平台的公开精选，平台接口不可用时使用通用推荐；已登录账号的个人推荐仍优先，公开内容不会标成个人推荐。

首页与各推荐来源保留快照和封面，普通导航及返回已加载来源不重新请求。主动换批、账号或连接变化、日期变化、缓存过期时更新；通用推荐更新事件只使通用快照失效。快照按连接、平台与账号隔离，正常有效期为 15 分钟，准备中的推荐短暂缓存。

主导航保留主页、歌单、排行榜、我的列表、下载、设置，已移除独立的“Docker 音乐”工作区。

| 入口 | 数据与执行位置 |
| --- | --- |
| 我的列表 → 音乐库 | Docker 媒体目录；刷新按钮扫描服务器，不打开电脑文件选择器 |
| 我的收藏、自建歌单、播放历史 | 同一服务器上的共享数据，Android 与桌面使用同一份 |
| 搜索、歌单广场、排行榜、专辑、首页推荐 | Service 接口；沿用原生列表、收藏弹窗和播放器 |
| 设置 → 音乐平台账号 | QQ 音乐、网易云、酷狗在设备上登录；账号歌单与个人推荐使用统一列表和 Docker 播放 |
| 下载 | Docker 执行；完成后进入同一音乐库；移除任务保留音乐文件 |
| 设置 → 音源与解析、下载设置 | 服务器共享配置；音源顺序、平台回退由后台处理 |
| 外观、播放音质、音频输出、快捷键、桌面歌词、临时播放队列 | 当前设备 |

“设置 → 下载”提供“边听边存（播放时自动下载）”。该开关三端共享，在线歌曲实际开始播放后按最高可用音质保存；重复播放复用下载，曲库歌曲不再次下载。它独立于手动下载的“启用下载”开关，现有开关值保留。

账号凭证仅保存在当前设备，Docker 不托管账号。账号歌单须显式导入；同账号同歌单在两端使用同一服务器标识，重复导入补充歌曲，保留服务器已有修改。导入过程中切换账号或服务器会停止后续写入。个人推荐在主页选择来源；平台不可用时明确显示服务器推荐。QQ 官方日推需要额外授权，未授权时可使用账号雷达推荐。

按用户选择，平台账号和网页登录会话以普通 JSON 保存在 App 数据目录的 `account-data/`，新数据不写入系统钥匙串。macOS/Linux 使用目录 0700、文件 0600 和原子替换；网页登录保留 HttpOnly、Secure 和有效期。旧加密凭证仅兼容读取迁移，首次迁移可能仍需旧记录的系统解锁；迁移后不再读取旧存储。旧 Cookie 数据库在读取前自动保留私有备份，无法解密时保留原记录并可重新授权。退出账号会清除当前会话且不会从旧记录自动恢复。

云盘、旧版点对点同步与远程备份保留兼容说明，不作为服务器设置。原有本机账号、歌单与数据不会自动上传、清空或覆盖。

## 现有数据

沿用独立预览包身份 `io.github.qmusic.docker.preview` 和默认配置目录 `~/Library/Application Support/q-music-docker-preview`，不会覆盖正式 Q-music。

旧客户端歌单、音乐文件、音源脚本和配置保留；没有自动上传、覆盖或删除操作。列表滚动位置、当前列表和播放恢复信息按服务器地址另存，避免覆盖旧记录或在服务器之间混用。Docker 中原有数据不做迁移；音乐库展示以当前连接的服务器内容为准。

连接失败显示状态，不能回退到本机数据库或本机音源。切换服务器前先验证地址，通过仅限主窗口的原生重载通道释放旧会话；现有导航安全策略保持不变。

## 安装包

最新 Mac ARM64 包位于本机 `artifacts/home-unified-final/`，首页缓存及三端验证记录位于 `artifacts/home-unified/verification/`，此前各轮预览归档保留。安装包、测试报告和临时数据不提交到源码仓库。

- macOS：`darwin-arm64/`、`darwin-x64/`
- Windows：`win32-x64/`、`win32-arm64/`
- Linux：`linux-x64/`、`linux-arm64/`

每个目录中都有 `Q-music-Docker-0.4.23-service.6-*.zip` 或 `*.tar.gz`。校验值和验证记录位于 `artifacts/navigation-performance/SHA256SUMS.txt`、`artifacts/navigation-performance/verification/`。macOS 使用本地 ad-hoc 签名，未公证；Windows 未签名。

## 验证与复现

```sh
Q_SERVICE_ROOT=/path/to/TuneFlow npm run test:service
npm test
node_modules/.bin/tsc --noEmit -p src/renderer/tsconfig.json
npm run build
node scripts/verify-service-artifacts.cjs freeze
node scripts/pack-service.cjs darwin-arm64 win32-x64 linux-x64 darwin-x64 win32-arm64 linux-arm64
node scripts/verify-service-artifacts.cjs darwin-arm64 win32-x64 linux-x64 darwin-x64 win32-arm64 linux-arm64
```

跨客户端测试加载桌面和相邻 `../qmusic-client` 的实际适配器，使用独立临时后台，覆盖双向歌单/收藏、账号歌单追加导入与重复导入、敏感字段过滤、曲库歌单往返、下载与文件保留、设备队列隔离、历史与共享设置。测试让酷我脚本故意解析失败，经真实后台搜索匹配切换网易云后读取音频流；导入的 QQ 歌曲也验证后台跨平台解析。地址隔离、旧存储不被写入、过期响应、原生重载调用权限均有边界测试。

首页恢复的历史验收见 `artifacts/home-recommendations/verification/verification.json`；本版导航测量与包校验见 `artifacts/navigation-performance/verification/`。不能把安装包完整性检查等同于 Windows/Linux 系统实机验证。

本轮测试、真实账号验收、构建及打包结果以本版验证记录为准。真实 QQ 授权由用户在官方页面完成；验收记录只保存状态和数量，不保存账号、歌单名称或凭据。网易云、酷狗的真实账号验收与 Windows/Linux 实机运行不因自动化测试通过而视为完成。

## 首页推荐恢复（service.5）

恢复上游 v0.4.23 的四格封面、日期、推荐来源、前九首“今日发现”、推荐/账号歌单详情和当前歌曲播放状态。账号管理仍由统一设置页负责；首页保留账号状态、歌单展示及设置入口。平台个人推荐优先，不可用时明确回退 Docker 推荐；已有显式服务器来源偏好保留。推荐、账号歌单的歌曲仍通过 Service 解析和播放。

“刷新推荐”在服务器推荐模式下调用 POST 换批接口，保留当前批次等待完成。客户端通过现有五秒轮询接收 recommendations.updated 快照，自动加载新结果，不重复提交换批。QQ 单首详情失败只跳过该曲；账号归属、服务器切换和取消保护保留。普通网络失败保留当前结果，账号改变时清除旧账号结果。

验证记录见本版 artifacts/home-recommendations/verification：43 项跨端集成检查、51 项服务端推荐/切换回归、桌面真实 QQ 会话复用与首页展示、隔离后台原生页面换批及 Docker 播放、六平台包内 84 个构建文件与两个原生模块校验。Windows/Linux 和 Intel Mac 的实际运行仍需对应设备验收。

## 侧边导航响应（service.6）

主导航和设置分类切换立即显示内容，取消整页淡入及位移动画；选中指示条保留 120ms 动画。生产模式的完整 DOM 布局快照改为按需诊断，保留异常日志和弹窗清理。需要布局诊断时设置 `localStorage['qmusic.debug.renderer'] = '1'` 后重载，完成后删除该键。

没有引入新的页面缓存，不改变账号会话、数据刷新、服务器同步或 Docker 播放。Android 在本轮没有改动。

`npm run test:navigation` 覆盖诊断开关、异常日志、弹窗清理及现有浏览导航逻辑；`node scripts/verify-navigation-performance.cjs` 使用生产包、隔离临时配置和合成 HTTP 数据验证 19 次主导航、12 次设置切换、快速连点、设置深链接及键盘导航。可通过 `Q_BENCH_EXE` 和 `Q_BENCH_OUT` 指定对比包与报告位置，不读取真实账号或写入 Docker 数据。

macOS ARM64 对照测量：主导航内容完全显示的中位耗时从 247.0ms 降至 13.9ms，设置分类从 230.3ms 降至 14.0ms。新版最大样本分别为 128.3ms、53.5ms，首次挂载及环境负载仍会影响个别切换；这些数字来自固定合成数据，不能代表所有设备或网络。32 项导航测试、渲染进程类型检查、定向 lint 和生产构建通过；快速连点后仅保留一个页面，设置深链接和键盘导航通过，无渲染异常。详细样本见 `artifacts/navigation-performance/verification/comparison.json`。

## 独立 Web 构建

`npm run build:web` 输出 `dist/web-client`，不覆盖 Electron 产物。Web 使用页面所在同源 Service，浏览器偏好独立存储；平台登录、账号个人推荐和桌面专属能力使用原生客户端，已导入服务器的账号歌单在 Web 共享。`npm run test:web` 验证浏览器存储、IPC 边界及订阅清理；实际浏览器验证入口为 `scripts/web-service-fixture.cjs` 和 `scripts/verify-web-client.cjs`，证据见 `artifacts/web-client/verification/`。

默认前端候选及原 Vue `/V2/` 的组合构建，在 Service 仓库运行 `npm run build:web:qmusic -- /path/to/qmusic-desktop`。使用与切换说明见 Service 仓库 `docs/qmusic-web.md`。该构建不会自动部署或更改当前 Docker 默认页面。

## 第二轮页面切换优化

列表首次渲染取消额外帧等待，下载页按可见行渲染并缓存页面；离开下载页停止轮询，返回后刷新，保留滚动位置与已发送的操作。Web 歌单浏览沿用原生平台排序标识。

本机固定数据、150ms API 延迟下，已访问页面的内容显示中位耗时：排行榜 63.1 → 30.2ms，我的列表 64.4 → 30.1ms，下载 181.6 → 31.2ms。1500 个下载任务只渲染可见行。首次加载仍受接口速度影响。

`npm run test:navigation` 包含虚拟列表与下载页生命周期测试；`npm run test:web` 包含原生排序契约测试；`npm run test:native-window` 检查 macOS 原生窗口控件边界。运行 `scripts/verify-navigation-ready.cjs` 可复测生产包或 Web（`Q_PERF_EXE`、`Q_PERF_WEB_URL`、`Q_PERF_OUT`），使用独立临时配置和合成数据。

跨端测试默认使用相邻 `../qmusic-client`，Service 路径可通过 `Q_SERVICE_ROOT` 指定。Mac ARM64 与 Chromium 已做运行验证；Android 真实 QQ 授权仍按用户选择待验收。
