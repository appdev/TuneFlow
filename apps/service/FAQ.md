# TuneFlow（音流）常见问题

## TuneFlow 如何运行？

TuneFlow 由 Node.js Service 与浏览器 Web UI 组成。Service 管理设置、歌单、音源、下载、本地媒体库和持久化数据；浏览器通过同源 API 使用这些能力。

## 如何启动？

```sh
npm ci
npm run build:service
npm run start:server
```

然后打开 <http://127.0.0.1:3124>。更多环境变量和部署说明见 [Server + Web 文档](./docs/server-web.md)。

## 可以直接暴露到公网吗？

不可以。当前 Service 没有身份认证、多租户隔离或公网安全加固。若需在可信局域网访问，可设置 `TUNEFLOW_HOST=0.0.0.0`，并通过防火墙或反向代理限制来源。

## 数据保存在哪里？

数据根目录由 `TUNEFLOW_STORAGE_ROOT` 指定，默认是 `./data`。数据库为 `tuneflow.data.db`，下载与本地媒体位于其 `audio/` 子目录。备份前应停止 Service，并备份完整数据根目录。

## Docker 升级后看不到旧数据怎么办？

新版 Compose 使用 `tuneflow-data` 数据卷。先停止新旧容器，将升级前数据卷中的完整 `/data` 内容复制到新卷，再启动 TuneFlow。若新旧数据库文件位于同一数据根目录，Service 会自动迁移数据库文件和旧设置键。

## 如何导入自定义源？

设置页只接受网络 URL。请仅导入你信任且有权使用的源脚本。新版运行时接口为 `window.tuneflow`；导入旧格式脚本时，Service 会在隔离执行前转换旧运行时属性。

## 如何反馈问题？

请在 [TuneFlow Issues](https://github.com/appdev/TuneFlow/issues) 中提供版本、操作系统、复现步骤和相关日志。不要提交凭据、Cookie、私有媒体地址或个人数据。
