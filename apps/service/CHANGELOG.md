# TuneFlow change log

## TuneFlow 2.13.14 - 2026-11-03

- 移除旧前端及 /V2/ 入口，使用共享新版 Web；音乐 SDK 独立于界面源码，增加共享 Web 播放、下载与音乐库验收。

## Unreleased

- 将应用品牌统一为 TuneFlow（音流），并使用 TuneFlow 图标。
- 将浏览器运行时、类型命名空间、Service SDK、环境变量、Docker 服务及数据卷更新为 TuneFlow 命名。
- 数据库改为 `tuneflow.data.db`，并增加旧数据库文件与持久化设置键的自动迁移。
- 自定义源运行时改为 `window.tuneflow`，同时在导入阶段兼容转换旧格式脚本。
- 更新 README、FAQ、Service 文档、项目元数据、Issue 模板和构建配置。
