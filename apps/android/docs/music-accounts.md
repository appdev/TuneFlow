# 音乐账号登录与歌单导入

## 从电脑导入 QQ 音乐登录状态

先在新版 PC 的「音乐账号管理 → QQ 音乐」用微信登录并点击「连接手机」。安卓在「平台歌单 / 官方音乐账号 → QQ 音乐 → 微信登录」直接进入电脑配对页，用应用内扫码或展开「改用配对码连接」粘贴。已登录时可使用「从电脑更换账号」，无需先退出原账号。两端连接同一局域网，核对显示的账号后确认使用。

微信标签不再加载旧的网页二维码，也不需要保存二维码再拿到另一块屏幕展示。配对页使用不透明背景与可滚动布局；专用扫码页支持返回、补光和横竖屏取景，切换标签或离开页面会取消未完成的连接。

配对码 3 分钟过期、仅领取一次；失败后需在电脑重新生成。相机权限仅在主动扫码时申请，不授权也可以粘贴。手机确认前会实际查询 QQ 音乐验证账号；取消、失败不替换原账号。确认后使用 Android Keystore 与原子文件加密保存，重启后自动读取；退出或重新登录会清除导入的凭据。导入登录状态不会直接覆盖本地歌单。

传输为局域网 HMAC-SHA256 身份证明 + AES-256-GCM 密文，只接受私有 IPv4 地址，不跟随重定向，不通过云端中转。二维码与配对码含短时连接密钥，仅供自己的手机使用。系统相机直接打开配对深链暂不处理，请使用应用内扫码。

`npm run test:account-transfer` 验证凭据校验、保存失败、账号切换与失效处理。扫码、真实 Android 网络、保存后重启仍需真机验收；此次未安装或覆盖用户的模拟器测试版。

本轮增加酷狗音乐扫码登录和账号歌单导入，修复 QQ 音乐微信扫码后的凭证识别。

## 使用入口

- PC：首页的音乐账号入口，或“我的列表 → 导入歌单 → 平台账号 → 酷狗”。使用酷狗音乐 App 扫码并确认后，选择需要导入的歌单。
- Android：“设置 → 官方音乐账号 → 酷狗音乐”，也可从首页账号入口进入。同机操作可截图后使用酷狗扫一扫的相册识别。
- Android 的 QQ 音乐页「微信登录」使用电脑配对，微信授权在 PC 官方登录窗口完成。
- 酷狗支持登录、自己的歌单与收藏导入、账号每日推荐；播放仍使用已配置的音乐源，不包含会员播放。
- 首页可直接切换 QQ、网易云、酷狗推荐来源，并记住选择；账号页也可设置首页推荐平台。QQ 官方每日 30 首的额外授权可从 QQ 账号页进入，网易云和酷狗日推无需此授权。
- 平台推荐不可用时明确显示本地精选，退出账号会清除推荐缓存。

## 行为与存储

- QQ 与微信使用各自的音乐账号 ID、凭证与 `tmeLoginType`，不把通用 QQ 授权当作音乐登录成功。
- PC 验证音乐接口成功后才关闭登录窗口；Android 在页面加载、恢复前台和扫码轮询时更新 Cookie 状态。
- 酷狗二维码、登录状态和账号歌单请求直接访问酷狗官方 HTTPS 域名，不向第三方 API 发送凭证。
- PC 使用 Electron safeStorage；Android 使用 Keystore + AES-GCM 保存酷狗凭证。Android 凭证文件放在不参与备份的目录。
- 导入歌单记录来源账号，避免不同账号同名歌单相互覆盖。分页和歌曲详情完整取得后才保存，失败或取消保留原歌单。
- 凭证失效后可重新登录；退出账号会清除本机凭证。
- 酷狗歌单按平台总数继续分页，兼容服务端缩小每页返回数量；歌曲详情按文件及音质 hash 核对，避免歌曲 ID 去重引发误报。偶发缺失详情只补查一次，仍缺失或分页重复时保留原歌单。

## 验证

`npm run test:accounts` 覆盖微信/QQ 身份区分、扫码状态、酷狗签名、分页不完整、异常脱敏，以及各端实际调用路径。

真实账号扫码、授权后私有歌单读取属于人工验收项。二维码接口连通与自动化模拟通过不等于真实账号端到端登录通过。

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
