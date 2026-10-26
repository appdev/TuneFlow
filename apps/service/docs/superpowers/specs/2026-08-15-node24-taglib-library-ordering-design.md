# Node 24、TagLib-Wasm 与本地曲库排序设计

## 目标

将 Service 运行时从 Node 22 升级到 Node 24 LTS，用 `taglib-wasm` 作为 MP3、
FLAC、APE、WAV 四种下载格式的唯一元数据写入器，保证新下载文件能可靠写入
标题、歌手、专辑、封面与歌词；本地曲库固定按下载完成时间倒序返回，最新下载
的歌曲排在最前。

## 已确认的故障

- 下载解析阶段已经取得封面字节、图片 MIME 和歌词，搜索结果并未丢失元数据。
- MP3 原先使用 `node-id3`，可以写入封面和歌词，但形成了第二套写入和错误处理
  路径。
- FLAC 仍走 `src/common/utils/musicMeta/flacMeta.js`：它把 `APIC` 当作 URL，收到
  `Buffer` 时会跳过封面；它的下载器还根据字符串对象上不存在的 `protocol`
  选择 HTTP 客户端，使 HTTPS 封面下载失败。
- 旧写入器吞掉失败并继续写剩余标签，因此下载任务显示完成却没有封面。
- 曲库扫描器按 `readdirSync` 枚举顺序把条目放入 `Map`，没有显式排序；Flutter
  客户端保持 API 顺序，因此用户看到的是文件系统枚举顺序。

## 运行时与依赖

- Docker 构建和运行阶段统一使用 `node:24-bookworm-slim`。
- 根包 `engines.node` 改为 `>= 24`，TypeScript Node 类型升级到 Node 24。
- Service 的三个 esbuild 目标统一改为 `node24`，CI 使用 Node 24。
- 使用 `taglib-wasm@^2.0.0`；根依赖和 `dist/server/package.json` 都必须声明，确保
  隔离后的 Service 包含 JS、WASI 适配层及 Wasm 资源。
- 移除 `node-id3`。MP3、FLAC、APE、WAV 全部通过相同的 TagLib-Wasm 适配器和
  写后回读验证。

## 统一音频写入边界

`src/server/downloads/taglibMetadata.ts` 负责把规范化后的元数据写入 MP3、FLAC、
APE、WAV。模块维护一个惰性初始化的 `TagLib` Promise，避免每首歌重复初始化
Wasm，并由 TagLib 根据文件内容识别容器。

写入接口接收：

- `title: string`
- `artist?: string`
- `album?: string`
- `picture?: Uint8Array`
- `pictureMimeType?: string`
- `lyrics?: string`

调用 `TagLib.edit(filePath, callback)` 在路径模式下原位编辑：基础标签通过
`file.tag()` 设置；封面通过 `file.setPictures()` 写成 `FrontCover`；歌词通过
`file.setLyrics()` 写成语言为 `zho` 的非同步歌词。TagLib 分别持久化为 MP3 的
ID3v2、FLAC 的 Vorbis Comment/PICTURE、APE 的 APEv2、WAV 的 RIFF INFO 与
ID3v2。缺失的可选值保持原有标签，不为了本次下载设置而删除上游文件已有内容。

封面 URL 仍在 `applyDownloadMetadata` 边界通过标准 `fetch` 下载并转换成字节；
播放器解析阶段已经提供封面字节时不得再次联网。图片 MIME 优先使用解析阶段提供
的值；URL 回退下载使用响应 `Content-Type`，无法得到受支持 MIME 时根据 JPEG、
PNG、WebP 魔数判断。无法确定 MIME 时抛出错误，由下载任务现有 `warning` 字段
明确报告，不再静默忽略。

写入后使用 `music-metadata.parseFile` 回读：核对标题、歌手、专辑以及启用项对应
的封面和歌词。歌词验证按容器接受 Vorbis、ID3v2 或 APEv2 原生标签；不能只检查
FLAC 的 `native.vorbis`。验证失败视为元数据失败，音频仍保留且下载任务以
completed + warning 完成，沿用现有可恢复策略。

## 旧实现退役

Service 切换完成且测试通过后，删除只被该分支使用的旧入口：

- `src/common/utils/musicMeta/index.js`
- `src/common/utils/musicMeta/index.d.ts`
- `src/common/utils/musicMeta/flacMeta.js`
- `src/common/utils/musicMeta/downloader.js`
- `src/common/utils/musicMeta/mp3Meta.js`

同时从根包和隔离 Service 包移除 `node-id3`。

`src/common/utils/musicMeta/buildLyrics.ts` 保留，歌词组合规则不变。

## 下载时间与排序

`DownloadManager` 新增按最终文件路径查询完成时间的只读方法。对于仍有 completed
下载记录的文件，下载时间采用该记录持久化的 `updatedAt`；这样重新扫描或补写
标签不会改变原始下载顺序。

`LibraryScanner` 增加下载时间查询依赖，并在 DTO 中返回 `downloadedAt`（Unix
毫秒）。没有下载记录的历史文件或手动导入文件，优先使用有效的
`stat.birthtimeMs`，否则使用 `stat.mtimeMs`。

`LibraryScanner.list()` 统一排序：

1. `downloadedAt` 降序；
2. 时间相同时按文件显示名称进行中文本地化升序；
3. 名称仍相同时按稳定的曲目 ID 升序。

`GET /api/v1/library/tracks`、`POST /api/v1/library/scan` 和服务端事件快照都消费同一
个 `list()` 结果。Flutter 无需二次排序，继续保持服务端返回顺序。

## 兼容性与数据边界

- 不自动改写现有音频文件。旧文件在显式重新下载或后续单独授权的补全操作前，
  仍可能缺少封面；本次不把启动或普通扫描变成会修改用户音频的操作。
- 不改变下载命名、冲突后缀、原子发布、完整性校验或资源派生规则。
- 不新增系统级 `metaflac` 或 FFmpeg 运行时依赖。
- 新增 `downloadedAt` 是向后兼容的响应字段；未知字段应被现有 Flutter 模型忽略。
- 保留工作区所有无关的未提交修改；实现阶段只协调目标文件的现有差异。

## 验证标准

- Node 24 下依赖安装、lint、单元测试和 Service 构建通过。
- MP3、FLAC、APE、WAV 四种真实容器使用内存封面字节后，回读得到标题、歌手、
  专辑、封面和歌词。
- HTTPS/URL 封面路径通过标准 fetch，失败能传递到下载任务 warning。
- `dist/server` 隔离运行时能够加载 `taglib-wasm` 及其 Wasm 资源。
- 两首不同下载时间的音乐始终最新在前；同时间排序稳定。
- 有下载记录的文件以记录时间排序，手动文件按 birthtime/mtime 回退。
- OpenAPI 包含 `downloadedAt`，现有图片、歌词和 Range 路由测试不回归。
