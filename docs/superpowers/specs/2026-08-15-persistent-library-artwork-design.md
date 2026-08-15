# 持久封面与本地曲库资源设计

## 目标

修复 Flutter 客户端中已加载封面在应用重启后重新缺失的问题，并让 Service
本地曲库通过安全的 HTTP 资源接口提供音频文件的内嵌封面。Service 不向客户端
暴露主机文件路径，Flutter 也不直接读取 Service 主机上的 `file://` 或
`content://` 地址。

本任务同时整理 Service 已经存在但尚未完成的本地歌词资源草案：下载文件完成
元数据写入后，Service 将封面和歌词派生到独立目录；曲库扫描只负责为旧文件、
手动加入文件或已变化文件补齐派生资源。

## 已确认的现状

- Service 下载根目录固定为 `<storageRoot>/audio`，不能通过 API 修改。
- 默认下载直接写入 `audio/`；启用
  `download.isSavePathGroupByListName` 后按 Service 持有的歌单名建立一级目录。
- 文件名可使用“歌名 - 歌手”“歌手 - 歌名”或“歌名”，冲突时追加
  ` (1)`、` (2)`，不会覆盖已有文件。
- 下载先把临时文件原子发布到最终音频路径，再写入 MP3/FLAC 元数据，最后才
  标记任务完成并刷新曲库。
- Service 当前扫描使用 `music-metadata` 的 `skipCovers: true`，正式 API 只有
  `/api/v1/library/tracks/{id}/stream`。仓库中已有未提交测试草案期望
  `picture`/`lyrics` 资源路由，但生产代码尚未实现。
- Flutter 已使用 `cached_network_image_ce`。问题不是缺少缓存框架，而是图片
  文件默认写入系统可回收的 application cache，且本地曲库不把 Service 相对
  资源 URL 解析为可访问的绝对 URL。

## 范围

### 包含

- 只提取音频文件内嵌封面；不支持 `cover.jpg`、`folder.jpg` 等封面侧车图。
- 将派生封面写入 `<storageRoot>/cover`，将派生歌词写入
  `<storageRoot>/lyrics`。
- 让两个派生目录镜像 `audio/` 下的相对目录和实际最终文件名。
- 下载完成时立即派生资源；曲库扫描为旧文件、手动文件和变化文件补齐。
- 在本地曲库列表 DTO 中返回可选资源 URL，并提供安全资源读取路由。
- Flutter 使用现有图片缓存框架加载 Service 封面，并将磁盘缓存放入持久目录。
- 本地曲库、播放器、队列和相关入口使用同一个已解析封面 URL。

### 不包含

- 不支持 Service 主机本地路径或移动设备 `content://` 作为曲库封面源。
- 不把图片 Base64 放入曲库列表 JSON。
- 不把侧车图片作为封面来源。
- 不改变音频下载命名、分组、冲突后缀、完整性或原子发布规则。
- 不引入图片转码依赖；封面保持内嵌图片的原始编码。

## Service 存储布局

派生目录与音频目录同属 `storageRoot`：

```text
audio/123.mp3                 -> cover/123.mp3.jpg
                              -> lyrics/123.mp3.lrc
audio/歌单A/123.mp3          -> cover/歌单A/123.mp3.jpg
                              -> lyrics/歌单A/123.mp3.lrc
audio/歌单B/123 (1).flac     -> cover/歌单B/123 (1).flac.png
                              -> lyrics/歌单B/123 (1).flac.lrc
```

派生文件名保留音频扩展名，再追加资源扩展名，避免同一目录下的 `123.mp3` 与
`123.flac` 互相覆盖。封面最后一个扩展名由实际 MIME 决定，例如 JPEG 使用
`.jpg`，PNG 使用 `.png`。Service 不把 PNG 字节伪装成 `.jpg`，也不为统一扩展名
重新编码图片。客户端不拼接或依赖派生文件名，只使用 Service 返回的资源 URL。

所有派生路径都必须从已经验证位于 `audio/` 内的最终音频路径计算。资源访问只按
扫描器登记的曲目 ID 查找，不接受调用方传入文件名或任意相对路径。

## 派生资源生命周期

新增一个边界清晰的本地资源存储组件，负责：

- 根据音频相对路径生成 `cover/`、`lyrics/` 目标路径；
- 读取内嵌封面和歌词，并将派生文件先写入 `tmp/` 后原子替换正式文件；
- 记录音频签名、封面 MIME/相对路径、歌词相对路径以及资源不存在的负结果；
- 合并同一音频的并发派生请求；
- 在音频变化或消失时替换或清理旧派生资源；
- 向路由层提供经过路径校验的只读资源描述，而不是公开文件系统路径。

音频签名至少包含实际相对路径、大小和修改时间。签名未变化且持久索引与派生文件
一致时，不重新调用 `music-metadata`。负结果也进入索引，所以没有内嵌封面的文件
不会在每次扫描时重复解析。

### 新下载

下载流程保持现有顺序：原子发布最终音频文件，完成可选元数据写入，然后调用资源
存储组件进行派生。只有这一步完成或产生可报告警告后，任务才进入 completed 并
触发曲库刷新。

封面或歌词派生失败不能删除已经完整下载的音频；下载任务保留 completed，并通过
现有 warning 字段报告资源派生失败。后续扫描可以重试没有形成有效索引的失败项。

### 旧文件和手动文件

Service 首次采用该功能时，扫描器会为缺少有效资源索引的现有音频解析一次元数据
并生成派生资源。之后的启动和刷新命中持久索引，不再重复读取内嵌封面。手动加入
或发生变化的音频按相同流程处理。

第一次升级扫描可能比后续扫描慢；这是一次性回填成本。处理保持异步且采用受控
并发，避免同时把大量音频和封面读入内存。派生组件只在单个文件处理期间持有该
文件的封面字节，不在内存中永久保存整个曲库封面。

### 歌词规则

歌词派生优先使用音频内嵌歌词；没有内嵌歌词时可以读取现有同名 `.lrc`，并统一
写入 `lyrics/` 下的 UTF-8 `.lrc`。本任务不增加在线歌词查询，也不改变下载设置
决定是否写入音频标签或原始同目录 `.lrc` 的行为。

## Service API

`GET /api/v1/library/tracks` 和 `POST /api/v1/library/scan` 的每个项目继续返回
现有 `streamUrl`，并在资源存在时增加：

- `pictureUrl`: `/api/v1/library/tracks/{id}/picture`
- `lyricsUrl`: `/api/v1/library/tracks/{id}/lyrics`

相同字段进入 `musicInfo` 可扩展元数据，使播放器队列保留本地资源身份。没有对应
资源时省略字段，不返回虚假 URL，也不暴露 `cover/`、`lyrics/` 的磁盘路径。

新增路由：

- `GET`/`HEAD /api/v1/library/tracks/{id}/picture`
- `GET /api/v1/library/tracks/{id}/lyrics`

图片响应直接流式读取已经派生的封面文件，返回正确 `Content-Type`、
`Content-Length`、`ETag` 和私有缓存头。曲目 ID 随文件身份变化，因此可使用长期
immutable 缓存。路由不得在请求时重新解析音频。

歌词继续使用统一 JSON 成功信封 `{ data: { lyric } }`。未知曲目与资源缺失使用
区分明确、路径不透明的 404 错误。OpenAPI 同步描述列表字段和资源路由。

## Flutter 数据流与图片缓存

`LibraryRepository` 负责把 Service 返回的相对 `pictureUrl`/`lyricsUrl` 用当前
`ServiceApi.origin` 解析为绝对 URL。通用 `Track.fromJson` 不猜测服务器地址。

本地曲库控制器不再过滤 Service 本地曲目的封面；列表、播放器、队列、迷你播放
器和封面背景都消费同一个规范化后的 HTTP(S) 地址。缺失或请求失败继续使用统一
确定性占位图，不显示透明空白。

Flutter 不新增手写图片下载器。现有 `cached_network_image_ce` 继续负责请求、
磁盘索引、并发合并、缓存命中、过期和清理。只把 `CeAppImageCache` 的文件目录从
application cache 改为 application support，使正常应用重启和系统缓存回收不会
删除已缓存封面。

升级时对旧 application cache 图片做尽力复制到新的 support 目录；只有复制完成
后新缓存才使用目标目录，旧目录不作为成功迁移的必要条件。迁移失败只导致对应
图片重新下载，不阻止应用启动。设置页现有“清理缓存”仍清理 CE 磁盘缓存、元数据
和 Flutter 内存图片缓存。

## 错误、安全与一致性

- 资源路径必须经过 `isPathInside` 等价检查，禁止目录穿越和符号链接逃逸。
- 只接受 `music-metadata` 返回的受支持图片 MIME，并设置合理的最大图片字节数。
- 文件不存在、签名变化或派生文件损坏时使索引失效并在下一次维护中重建。
- 删除或移动音频后清理旧封面、歌词和索引；用户音频本身永远不由资源清理逻辑
  删除或修改。
- 下载最终完整性在元数据写入和资源派生之后按现有规则记录；派生资源不计入音频
  完整性。
- Service 返回相对 URL，以兼容反向代理和不同客户端 origin；Flutter 负责解析。

## 验证标准

### Service

- 默认下载位于 `audio/`；歌单分组下载位于安全化的一级子目录，冲突后缀保持不变。
- MP3/FLAC 下载完成并写入元数据后，内嵌 JPEG/PNG 被原子派生到镜像 `cover/`
  路径；内嵌歌词派生到镜像 `lyrics/` 路径。
- 相同文件再次扫描不调用封面解析；没有封面的负结果也不重复解析。
- Service 重启后持久索引和派生文件继续命中。
- 旧文件和手动文件首次扫描得到一次性回填，修改后得到新资源。
- 列表只为存在的资源返回 URL；资源路由返回正确内容、MIME、长度、ETag 和缓存头。
- 未知 ID、缺少封面、缺少歌词和攻击者选择的路径均返回安全 404。
- OpenAPI 包含新增字段与路由，现有 stream Range 行为不变。

### Flutter

- 本地曲库相对封面 URL 使用当前 Service origin 解析，所有本地曲目消费者得到同一
  绝对 URL。
- 首次联网加载封面后，销毁并重建 `CeAppImageCache`，在网络不可用时仍从磁盘
  命中。
- 应用重启不依赖 Flutter 内存 ImageCache；系统清理 application cache 不影响新
  support 目录中的封面。
- 无封面和请求失败显示统一占位；不会把 Service 文件路径交给网络加载器。
- 清理本机缓存后图片文件、CE 元数据和 Flutter 内存图片缓存按现有设置行为清除。

## 实施边界

两个仓库分别验证并报告结果：

- Service：`/Volumes/ext/lx-music-server-web`
- Flutter：`/Volumes/ext/MusicFree/flutter-client`

实施时保留两个仓库当前所有无关的未提交更改，尤其是正在进行的播放历史、下载
完整性和 UI 工作。现有 `src/server/routes/library-resources.test.ts` 作为用户已有
测试草案协调修订，不直接覆盖其意图。
