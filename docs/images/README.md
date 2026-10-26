# 产品截图说明

这些图片用于[产品首页](../../README.md)、[桌面/Web 说明](../../apps/player/README.md)与 [Android 说明](../../apps/android/README.md)，截取于 2026-10-26。

| 文件 | 实际运行来源 | 页面 |
| --- | --- | --- |
| [web-home.png](web-home.png) | TuneFlow `ccad2035` 的共享 Web，Chromium，1600 × 1000 | 首页与通用推荐 |
| [web-playlist.png](web-playlist.png) | 同上 | “通勤时光 · 示例歌单” |
| [android-home.png](android-home.png) | Q-music v0.4.24 历史预览包（原发布仓库已删除），Android 15 / API 35，1080 × 2400 | 中文首页与推荐回退 |
| [android-playlist.png](android-playlist.png) | 同上 | 与 Web 相同的共享歌单 |

Web 使用已提交界面的独立构建，Android 使用兼容通道已发布的 ARM64 APK；没有把工作区内尚未提交的客户端功能作为发布效果展示。Android APK SHA256：`849fdc3f11502ca490a503d36b3bbb8f190d2d970d1755d590303bc5f0e751fb`。

两端连接同一个仅供截图的临时 Service，通过实际 API 加载歌单和推荐。曲目、艺术家、歌单名称与封面均为合成示例；封面标有 `TUNEFLOW / DEMO`，测试音频为无声音频。不使用私人账号、Cookie、真实个人歌单或正式音乐库，也不据此宣称已验收平台账号登录。

图片直接由浏览器或模拟器截取，没有后期修改控件、拼接页面或替换界面文字。首页“部分推荐来源暂不可用”来自示例环境仅提供有限来源，展示的是应用真实回退状态；不代表随应用附带可用音源、完整曲库或第三方音乐授权。

应用界面和安装包中仍保留 Q-music 兼容名称，仓库结构与下载入口以[产品首页](../../README.md)为准。更新截图时应继续使用独立数据、注明版本并检查隐私，避免把历史图片当作所有平台均已验收的证据。
