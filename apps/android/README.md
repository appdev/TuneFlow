# TuneFlow Android 客户端

本目录是 TuneFlow 的 React Native Android 客户端。Server、桌面/Web 与 Android 在同一个仓库维护，共享 API 与业务规则，各自独立安装依赖、构建和发布。

[产品首页](../../README.md) · [客户端下载安装](https://github.com/appdev/TuneFlow/releases) · [问题反馈](https://github.com/appdev/TuneFlow/issues) · [桌面/Web](../player/README.md)

## 界面预览

<p>
  <img src="../../docs/images/android-home.png" width="320" alt="Android 首页与每日推荐">
  <img src="../../docs/images/android-playlist.png" width="320" alt="Android 共享歌单列表">
</p>

截图来自已发布预览包的独立 Android 模拟器，连接与 Web 相同的隔离示例服务，不含私人账号数据。[截图版本与来源](../../docs/images/README.md)。

## 在产品中的位置

歌单、收藏、历史、音乐库、音源与下载由连接的 Server 管理；解析和自动切换平台也由服务处理。手机负责播放、后台媒体控制、界面与本机偏好。业务功能默认与桌面/Web 对齐，系统权限及原生能力使用 Android 适配器。

“音乐库”展示服务管理的音乐文件。手机原有数据不会因为连接服务自动上传或清空。数据归属与连接说明见 [统一客户端说明](README-service.md)。

## 安装与版本兼容

在 [TuneFlow Releases](https://github.com/appdev/TuneFlow/releases) 的 `client-v<version>` 版本下载匹配架构的 APK，并核对校验文件。架构不确定时可选 universal。附件保留 Q-music 名称；原发布仓库已删除，旧版用户需手动覆盖安装一次，不要卸载。预览应用 ID 与签名保持不变。

- Android 最低版本为 7.0（API 24）。
- 当前预览通道使用 `io.github.nshpiter.qmusic.mobile.preview`。
- 正式构建使用 `io.github.nshpiter.qmusic.mobile`，与预览通道不是同一个应用身份。
- 同一通道覆盖升级必须保留签名和应用 ID；不要通过卸载解决升级问题，以免丢失应用私有数据。

## 开发环境

与当前发布流水线一致的工具链：

- Node.js 22、JDK 21；
- Android SDK Platform 36、Build Tools 35.0.0；
- NDK 26.1.10909125、CMake 3.22.1；
- 开启 USB 调试的设备或 Android 模拟器。

以下命令在 **TuneFlow 仓库根目录** 执行：

```sh
npm ci --prefix apps/android
adb devices -l
npm --prefix apps/android start
```

另开终端运行调试版：

```sh
adb reverse tcp:8081 tcp:8081
npm --prefix apps/android run dev
```

## 构建

```sh
# 内置 JS bundle，可独立侧载的预览包
npm run build:android -- -PreactNativeArchitectures=arm64-v8a
# 依赖 Metro 的调试包
npm --prefix apps/android run pack:android:debug
```

预览 APK 输出到 `apps/android/android/app/build/outputs/apk/standalone/`，调试包输出到 `debug/`。不指定 `reactNativeArchitectures` 时使用脚本默认架构配置。

正式构建运行 `npm --prefix apps/android run pack:android`，需要原有正式签名配置；未配置密钥时会失败。现有 standalone 预览签名与正式签名分别维护，不要提交 keystore、密码或 `android/keystore.properties`，也不要为升级重新生成现有通道的密钥。

## 验证

```sh
npm run test:android
npm --prefix apps/android run test:accounts
npm --prefix apps/android run test:downloads
npm --prefix apps/android run test:qq-sync
```

涉及共享行为时，安装 Service、Player 依赖并运行根目录 `npm run prepare:service` 与 `npm run test:contract`。实体设备还需检查后台/息屏播放、通知权限、媒体键、蓝牙和网络重连；模拟器检查不能替代实机验收。

发布与应用身份兼容见 [单仓库说明](../../docs/monorepo.md)。

## 上游与许可

本客户端基于 [Q-music](https://github.com/Nshpiter/Q-music) 与 [LX Music Mobile](https://github.com/lyswhut/lx-music-mobile) 修改，是独立衍生项目，并非 LX Music 官方版本。

保留 [Apache License 2.0](LICENSE)、[NOTICE](NOTICE)、[二次修改记录](MODIFICATIONS.md) 和[原项目协议与免责声明](../service/README.md#project-agreement)。本项目不拥有第三方音乐、歌词或封面等版权数据。
