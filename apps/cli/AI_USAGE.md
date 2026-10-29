# AI 工具调用指南

入口：`node <仓库绝对路径>/apps/cli/bin/tuneflow.mjs <command> [options]`。
使用进程工具的 argv 数组传递参数，避免把用户输入插值到 shell。
Node 22+；首次使用需按 README 安装依赖、构建；播放还需要本机 mpv。

## 协议

默认 JSON。成功读取 `result.data`，失败读取 `result.error.code`。
退出码：0 成功，1 失败，130/143 表示调用被信号中断。没有交互式提示。
命令列表由 `--help` 以 JSON 返回，帮助中 `protocolVersion` 为 1。

## 典型任务

用户要求“播放周杰伦的晴天”：

1. 调用 `search 晴天 --source kw`。
2. 从 `data.list` 根据 `name` 和 `singer` 选择结果，提取 `ref`；不能只按歌曲名猜测 ID。
3. 调用 `play <ref>`。多首连播可传多个 ref。
4. 若返回 `loading`，调用 `status` 检查；错误时根据明确错误码处理。

用户问“现在播放到哪里”：调用 `status`，将 `positionMs` 和 `durationMs` 转为分秒。
字段为 `null` 时说明未知，不能用运行时间估算。

用户要求“连续显示 5 秒进度”：调用 `status --watch --interval 1000 --count 6`，
立即获得第一行，随后约每秒一行。按行解析 JSON，最后正常结束。
一般查询无需打开无限监听；需要长期监控时，使用支持流式输出和取消的进程工具。

用户要求“暂停 / 继续 / 往后跳 15 秒”：分别调用 `pause` / `resume` / `seek --by 15`。
后退使用 `seek --by -15`，跳到固定位置使用 `seek 90`，单位均为秒。

用户要求“查看本地音乐”：调用 `library`。这里的“本地”指选定 Service 的音乐库。
列表中的 ref 可以直接交给 `play`。如用户指的是 CLI 所在电脑的任意音乐目录，
应说明此命令不会扫描这些目录。

用户要求“下载歌曲”：先查询得到 ref，再调用 `download <ref>`，随后调用 `downloads`。
默认文件位于 Service 的音乐库。若明确要保存到 CLI 电脑，使用
`download <ref> --output <绝对文件路径>`，完成后返回保存路径。
遇到文件已存在，不能擅自添加 `--replace`；只有用户授权覆盖才使用。

## 会话和边界

- 同一个 `TUNEFLOW_CONFIG_DIR` 中的命令共享后台播放器，命令返回后音乐继续播放。
- `stop` 停止歌曲；`shutdown` 关闭整个后台会话。
- `status --watch` 被中断只结束监听。
- 搜索引用与 Service 绑定，切换地址后需重新查询，不能混用 ref。
- 不应解析或依赖 ref 的内部格式，更不能生成虚构的 ref。
- 未安装 mpv 时可搜索、下载、查看音乐库，播放返回 `PLAYER_UNAVAILABLE`。
- 不要求用户输入网易云开发者凭据；此 CLI 使用 TuneFlow Service 已有的能力。
- 平台登录、音源导入和授权维护由现有客户端完成。
