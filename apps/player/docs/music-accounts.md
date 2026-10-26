# 音乐账号登录与歌单导入

## 从电脑导入 QQ 音乐登录状态

电脑先登录 QQ 音乐（支持 QQ 或微信账号），在首页「音乐账号管理 → QQ 音乐」点击「连接手机」。安卓打开「平台歌单 / 官方音乐账号 → QQ 音乐 → 微信登录」，用应用内扫码或展开「改用配对码连接」粘贴，核对账号后确认使用。已登录时可选择「从电脑更换账号」。两端需使用包含此功能的新版本并处于同一局域网；多网卡电脑可切换地址。

配对有效期 3 分钟、仅领取一次，关闭窗口、退出账号或重新生成会使旧配对失效。网络使用 HMAC-SHA256 校验与 AES-256-GCM 加密；不通过云端中转，不转移 QQ 通用登录 Cookie。安卓先查询平台验证账号，再用 Android Keystore 加密保存，不写入备份。失败或取消保留原账号；成功导入只替换登录状态，本地歌单由用户另行导入/同步。

测试：`npm run test:account-transfer`。PC 与安卓构建通过，已有 PC 微信凭据供安卓请求代码使用的真人实验通过；新配对功能尚待 Android 真机验收，不能把桌面实验等同手机端端到端成功。

本轮增加酷狗音乐扫码登录和账号歌单导入，修复 QQ 音乐微信扫码后的凭证识别。

## 使用入口

- PC：首页的音乐账号入口，或“我的列表 → 导入歌单 → 平台账号 → 酷狗”。使用酷狗音乐 App 扫码并确认后，选择需要导入的歌单。
- PC 的 QQ 音乐与网易云使用官方网页登录，窗口适配显示器工作区，可调整大小；缩小时自动适配官方页面的最小布局，保留官方扫码与其他登录方式。
- Android：“设置 → 官方音乐账号 → 酷狗音乐”，也可从首页账号入口进入。同机操作可截图后使用酷狗扫一扫的相册识别。
- Android 的 QQ 音乐页「微信登录」使用电脑配对，微信授权在 PC 官方登录窗口完成。
- 酷狗支持登录、自己的歌单与收藏导入、账号每日推荐；播放仍使用已配置的音乐源，不包含会员播放。
- 首页可直接切换 QQ、网易云、酷狗推荐来源，并记住选择。QQ 默认使用账号雷达，官方每日 30 首的额外授权收纳在 QQ 账号卡片内；网易云和酷狗使用各自账号的每日推荐。
- 账号卡片右侧提供“管理／收起”和方向箭头，再次点击可收起。登录、导入和退出放在展开区域，切换卡片时自动收起上一项。
- 平台推荐不可用时明确显示“本地精选”，不会把本地结果标成官方日推。

## 行为与存储

- QQ 与微信使用各自的音乐账号 ID、凭证与 `tmeLoginType`，不把通用 QQ 授权当作音乐登录成功。
- PC 验证音乐接口成功后才关闭登录窗口；Android 在页面加载、恢复前台和扫码轮询时更新 Cookie 状态。
- PC 的全局导航拦截器与账号窗口共用官方域名规则。仅对应账号窗口及其授权子窗口可跳转到该平台的 HTTPS 官方页面；主界面保持原导航限制，回调 URL 不写入日志。
- 酷狗二维码、登录状态和账号歌单请求直接访问酷狗官方 HTTPS 域名，不向第三方 API 发送凭证。
- PC 使用 Electron safeStorage；Android 使用 Keystore + AES-GCM 保存酷狗凭证。Android 凭证文件放在不参与备份的目录。
- 导入歌单记录来源账号，避免不同账号同名歌单相互覆盖。分页和歌曲详情完整取得后才保存，失败或取消保留原歌单。
- 凭证失效后可重新登录；退出账号会清除本机凭证。
- 酷狗歌单按平台总数继续分页，兼容服务端缩小每页返回数量；歌曲详情按文件及音质 hash 核对，避免歌曲 ID 去重引发误报。偶发缺失详情只补查一次，仍缺失或分页重复时保留原歌单。

## 验证

`npm run test:accounts` 覆盖微信/QQ 身份区分、扫码状态、酷狗签名、分页不完整、异常脱敏，以及各端实际调用路径。

真实账号扫码、授权后私有歌单读取属于人工验收项。二维码接口连通与自动化模拟通过不等于真实账号端到端登录通过。

PC 的 `test/officialAccountLogin.test.cjs` 覆盖官方 Cookie 异步回调、取消登录、重入窗口、子窗口清理及小屏幕布局。此前自定义 QQ／网易扫码方案在真实授权阶段失败，现已撤下；不把二维码可获取或自动化模拟通过作为真实登录成功的证据。

微信卡在“扫描成功”的实机诊断：微信轮询已返回 405 和授权码，但全局 `will-navigate` 监听器用空白名单拦截了官方顶层回调。对当前授权窗口修正导航规则后，同一次手机确认成功完成官方回调、写入音乐凭证、通过音乐接口验证并自动关闭登录窗口。已增加两层规则同时生效、窗口权限隔离和伪装域名拒绝的回归覆盖。

## 协议参考


酷狗官方接口字段和签名协议参考 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)，按项目结构重新实现，未引入第三方代理服务。许可如下：

MIT License

Copyright (c) 2023 MakcRe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
