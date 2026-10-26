# 单仓库边界与兼容

源代码导入自 Service 9f4dcdbd、桌面/Web 50de9ca4、Android 8f85b4c4。Git subtree 未使用 squash，历史提交仍可追溯。服务目录采用可追踪的重命名，原代码目录保留作本机回退。

## 保持不变的运行边界

- 服务：Node 24、SQLite 13.0.3，配置/音乐卷和 /api/v1/ 路由保持不变。
- 桌面：Electron 40.9.2 的 ABI 143 原生绑定单独打包；appId io.github.qmusic.docker.preview，profile q-music-docker-preview。
- Android：io.github.nshpiter.qmusic.mobile.preview；现有 standalone 签名及正式签名配置保持不变。
- Web：继续复用桌面 Vue 页面；官方授权、本地存储和原生能力通过各自适配器完成。
- 配置键：桌面 qmusic.docker.endpoint.v1、Android qmusic.service.endpoint.v1 都保留。
- Flutter 不导入、不安装、不构建。旧 Web 暂留 apps/service 内，因服务端 provider SDK 仍依赖部分旧音乐 SDK，不在本次重写。

## 独立构建和发布

保留各应用 package.json、lockfile 和依赖安装目录。共享模块不导入 React/Vue/Electron 或服务端数据库；平台会话、界面、轨道对象与存储保持适配边界。

客户端旧发布地址 appdev/Q-music、vX.Y.Z 标签、APK/归档命名和 checksum 文件保持兼容。TuneFlow 提供可复用构建入口，旧仓库只需保留薄发布入口调用固定 TuneFlow 提交；仓库令牌留在实际发布仓库，不需要把账号 Cookie 或签名凭据写进源代码。旧 Release、标签和源码分支保留，不做重写。

服务端发布从 apps/service 读取版本，只发布服务镜像；客户端发布失败不阻塞服务端修复。当前任务不发布新版本，也不改变任何线上容器。

客户端构建入口支持 desktop、web、android 或 all，首先解析一次源码提交，随后所有任务只检出这个固定 SHA。兼容发布入口在完整上传所选端的安装包和校验文件后，才更新旧仓库的公开更新元数据；API、raw 和 CDN 回退线路均保留，且不允许把更新通道降回较旧版本。现有公开附件不覆盖。

## 验收与回退

运行根测试检查历史、默认 Docker Web、应用身份、更新地址、共享代码的唯一来源。随后运行 Service 测试、跨端真实 Service 契约、桌面/Web 构建、Android standalone 构建及隔离 UI 流程。官方账号登录需本人授权，自动化使用合成数据并与已有用户数据隔离。

源代码可切回迁移前分支或提交回退；不需要回滚用户数据。应用更新时不卸载、不变更身份和数据目录；更新地址重定向或关闭旧仓库不属于本次任务。
