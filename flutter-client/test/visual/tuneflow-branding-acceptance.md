# TuneFlow 五端窗口与品牌验收

日期：2026-08-12

## 支持范围

- Flutter 工程已包含 Android、iOS、macOS、Windows、Linux，未生成 Web。
- 业务页面、Service API、技术包名和存储标识保持共享及兼容。
- 桌面窗口能力使用 `window_manager 0.5.2`；macOS 原生标题栏能力使用 `macos_window_utils 1.9.1`。

## 窗口行为

- macOS：使用左上角原生红黄绿交通灯，Flutter 不再绘制右上角三按钮。
- Windows：右上角显示最小化、最大化／还原、关闭；关闭按钮具有危险悬停状态。
- Linux：使用独立尺寸和圆角的右上角窗口控制区，不复用 Windows 视觉常量。
- Android、iOS：不初始化或渲染桌面窗口标题栏。
- 桌面标题栏视觉高度保持 38dp，标题以内容中心为基准。

## 自动化与视觉结果

- `flutter analyze`：通过，零问题。
- 平台、窗口控制器、品牌和应用壳聚焦测试：通过。
- `test/visual/full_ui_gallery_test.dart`：53/53 通过，包含原有 47 个功能视口及 macOS、Windows、Linux 各两个窗口视口。
- `test/visual/high_fidelity_gallery_test.dart`：6/6 通过。
- 视觉检查覆盖 1440×960、1024×768、390×844、360×800。
- Windows/Linux 控制区、macOS 安全区、标题中心、导航、播放进度与内容布局没有重叠。
- 移动搜索保持已验收的无封面列表；修正了高保真测试中已过期的移动封面断言。

## macOS 实机运行

- Release 产物：`build/macos/Build/Products/Release/TuneFlow.app`。
- Accessibility 检查识别到系统 `关闭按钮`、`全屏幕按钮`、`最小化按钮`。
- 窗口右上角不存在 Flutter 自绘控制按钮。
- 原生缩放／全屏和恢复操作已实际执行，窗口内容与播放条保持可用。
- 窗口名称为 `TuneFlow`，应用内中文品牌为“音流”。

## 平台构建

- macOS Release：成功，71.9 MB。
- iOS Debug（`--no-codesign`）：成功，产物为 `build/ios/iphoneos/Runner.app`。
- Android Debug APK：仍受本机 Kotlin compiler classpath 故障阻塞。错误发生于 `DataFlowInfo` 初始化并缺失 `javaslang.λ`，与改造前已记录的问题一致。
- Windows Release：已新增 `windows/` 工程及 `windows-latest` CI 构建任务；必须等待 Windows runner 实际成功后才能标记原生构建通过。
- Linux Release：已新增 `linux/` 工程、GTK 图标资源及 `ubuntu-latest` CI 构建任务；必须等待 Linux runner 实际成功后才能标记原生构建通过。

## 品牌资源

- Windows ICO 包含 16、24、32、48、64、128、256 像素规格。
- Linux PNG 包含 16、32、48、64、128、256、512 像素规格，并通过 GResource 嵌入 runner。
- Android、iOS、macOS、Windows、Linux 图标均由 `assets/branding/TuneFlow.png` 生成并通过校验脚本。
