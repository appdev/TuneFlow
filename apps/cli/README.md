# TuneFlow CLI

面向 AI 工具和脚本的命令行客户端。搜索、播放解析、下载和音乐库复用
`packages/service-client`，连接现有 TuneFlow Service。无需操作 TUI 或回答交互提示。

## 安装与启动

当前支持 macOS 和 Linux，要求 Node.js 22 或更新版本。本地播放需要安装 mpv，
并使 `mpv` 位于 `PATH`；也可以通过 `TUNEFLOW_MPV` 指定可执行文件的绝对路径。
搜索、音乐库和下载不依赖 mpv。

在仓库根目录执行（各应用保持独立依赖安装）：

```sh
npm --prefix apps/cli ci
npm run build:cli
node apps/cli/bin/tuneflow.mjs --help
```

可选：`npm link ./apps/cli` 后使用 `tuneflow` 命令。以下示例使用该短命令；
未链接时，将 `tuneflow` 替换为 `node apps/cli/bin/tuneflow.mjs`。
AI 工具建议直接使用 Node 和入口文件的绝对路径，避免工作目录和 npm 日志影响。
`npm run cli -- …` 也可供人工调试，但 npm 本身会额外输出脚本提示。

首次设置：

```sh
tuneflow configure --server http://127.0.0.1:3124
```

地址优先级：`--server` > `TUNEFLOW_SERVER` > 保存的配置 > `http://127.0.0.1:3124`。
配置前会检查 Service 健康状态和接口能力。CLI 沿用该 Service 已配置的音源，
不负责导入音源或平台账号登录。

## 输出协议

- 默认输出 JSON，`--json` 作为兼容参数接受。
- 成功：`{"ok":true,"data":…}`；失败：`{"ok":false,"error":{"code":"…","message":"…"}}`。
- stdout 仅含协议数据。错误也输出到 stdout，便于 AI 使用同一个解析入口。
- 成功退出码为 `0`，失败为 `1`，SIGINT 为 `130`，SIGTERM 为 `143`。
- 不输出上游播放地址或临时播放令牌，不通过 shell 启动播放器。

## 搜索、音乐库与歌单

```sh
tuneflow sources
tuneflow search "晴天" --source kw --page 1
tuneflow library
tuneflow playlists
tuneflow playlists default
```

`search` 返回 `data.list`，歌单详情返回 `data.tracks`。每首歌曲均包含 `ref`、
`id`、`name`、`singer`、`source`、`albumName` 和 `interval`。
未指定 `--source` 时使用 Service 能力列表中第一个支持歌曲搜索的平台。

`ref` 保存在本机，可跨进程复用，与 Service 地址和歌曲身份绑定。更换服务器时
需要重新搜索或读取音乐库；引用不匹配返回 `REF_SERVER_MISMATCH`。
歌曲可用性仍由当前 Service、音源和平台授权决定。

`library` 是当前 Service 管理的本地音乐库。连接远程 Service 时，它位于服务器；
CLI 不扫描本机任意目录。`playlists` 则是同一 Service 中的歌单。

## 后台播放和控制

```sh
tuneflow play <ref> --quality 128k
tuneflow play <ref1> <ref2>
tuneflow queue <ref3>
tuneflow pause
tuneflow resume
tuneflow next
tuneflow previous
tuneflow volume 60
tuneflow seek 90
tuneflow seek --by -15
tuneflow stop
tuneflow shutdown
```

`play` 创建或复用本地后台播放进程，在解析和提交播放请求后返回，不等待歌曲结束。
返回 `loading` 时，可查询 `status` 确认可播放状态；后续解码或媒体读取失败会报告
`error` 状态。默认音质为 `128k`，其他音质取决于音源能力。

`play <ref...>` 替换播放队列，`queue <ref...>` 追加队列，歌曲自然结束后自动播放下一首。
队列最多容纳 1000 首歌曲，索引从 0 开始。`stop` 停止音频，`shutdown` 同时关闭后台进程。
每个配置目录拥有一个独立播放会话，多个 AI 命令操作同一会话；队列不会跨后台进程重启恢复。

播放器通过继承的双向管道连接 mpv。关闭或异常终止后台进程会关闭管道，mpv 随之退出；
协议依据 [mpv JSON IPC 文档](https://mpv.io/manual/stable/#json-ipc)。

## 播放进度

```sh
tuneflow status --json
tuneflow status --watch --interval 1000 --count 10
```

单次查询示例：

```json
{
  "ok": true,
  "data": {
    "state": "playing",
    "track": { "ref": "…", "id": "a", "name": "晴天", "singer": "周杰伦", "source": "kw" },
    "positionMs": 83000,
    "durationMs": 269000,
    "progress": 0.30855018587360594,
    "volume": 60,
    "queue": ["…"],
    "queueIndex": 0,
    "observedAt": "2026-10-27T06:00:00.000Z"
  }
}
```

- `state`：`stopped`、`loading`、`playing`、`paused`、`ended` 或 `error`。
- 时间单位为毫秒，进度为 `0..1`；未知位置、时长或进度返回 `null`。
- 数据来自 mpv 实际属性；播放结束后保留最后查询到的位置，不推算为 100%。
- `observedAt` 为 UTC 格式的查询时间。
- `--watch` 每次查询输出一行完整 JSON（JSONL），包含当前播放状态和进度。
- 间隔为两次查询之间的等待时间，允许 `100..60000` 毫秒，默认 `1000`。
- `--count` 控制输出行数；省略时持续运行，直到 SIGINT/SIGTERM 或管道关闭。
- 暂停、切歌、播放结束等状态在下一次查询报告。停止监听不会停止后台音乐。
- 监听遇到接口或进程错误时，输出错误对象并以非零状态退出。

AI 工具通常使用单次查询，或为监听指定 `--count`，避免一直占用工具调用。

## 下载

```sh
tuneflow download <ref> --quality 128k
tuneflow downloads
tuneflow download <ref> --output /path/to/song.mp3
```

默认创建 Service 下载任务，返回任务 ID，再用 `downloads` 查询进度。完成后的音频
由 Service 音乐库管理。该进度沿用 Service 的字段定义，与播放进度分开。

`--output` 将歌曲流保存到运行 CLI 的电脑，等待下载完成后返回；也支持导出音乐库歌曲。
输出路径需指定文件名，父目录需存在，文件扩展名应与所选音质的实际编码一致；CLI 不转码。
先写同目录临时文件，完成后再提交；失败会清理临时文件。

已有文件或已有下载默认报错。只有用户明确允许替换时才添加 `--replace`。
Service 下载沿用服务端替换策略；本机保存只在完整下载成功后替换原文件。

## 状态文件与故障处理

默认配置目录：`~/.config/tuneflow-cli`，可通过 `TUNEFLOW_CONFIG_DIR` 隔离测试或多个会话。
目录中保存 Service 地址及歌曲引用，不保存平台凭据和解析后的临时播放 URL。
Unix 控制 socket 位于当前用户专用、权限为 `0700` 的临时目录中，配置/引用文件权限为 `0600`。

常见错误：

| code | 处理 |
| --- | --- |
| `INVALID_ARGUMENT` | 读取 `--help` 并修正参数 |
| `PLAYER_UNAVAILABLE` | 安装 mpv，或设置 `TUNEFLOW_MPV` |
| `PLAYER_NOT_RUNNING` / `NOT_PLAYING` | 先使用 `play` 开始播放 |
| `REF_NOT_FOUND` / `REF_SERVER_MISMATCH` | 在目标 Service 上重新查询歌曲 |
| `FILE_EXISTS` / `DOWNLOAD_ALREADY_EXISTS` | 保留现有文件，或在获准后使用 `--replace` |
| `NETWORK_ERROR` / `TIMEOUT` | 检查 Service 地址、网络和音源状态 |
| `PLAYBACK_FAILED` | 使用 `status` 检查，再选择其他歌曲或音质 |

更改 `TUNEFLOW_MPV` 后，先 `shutdown` 再播放，后台进程才会使用新的环境变量。

## 验证

```sh
npm run build:cli
npm run test:cli
```

集成测试通过本地 HTTP Service 契约 fixture 与 mpv JSON IPC fixture 验证独立进程的完整调用链，
不请求真实音乐平台。真实音频输出需要可用的 Service、音源和 mpv，需另行进行环境验证。

AI 调用约定和示例见 [AI_USAGE.md](AI_USAGE.md)。
