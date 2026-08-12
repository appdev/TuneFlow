import 'package:flutter/material.dart';

import '../design/design_tokens.dart';
import 'app_platform.dart';
import 'desktop_title_content.dart';
import 'desktop_window_controller.dart';
import 'linux_window_controls.dart';
import 'windows_window_controls.dart';

final class PlatformWindowFrame extends StatelessWidget {
  const PlatformWindowFrame({
    super.key,
    required this.platform,
    required this.location,
    required this.controller,
    required this.child,
    this.onBack,
    this.onSearch,
  });

  final AppPlatform platform;
  final String location;
  final DesktopWindowController controller;
  final Widget child;
  final VoidCallback? onBack;
  final VoidCallback? onSearch;

  @override
  Widget build(BuildContext context) {
    if (!platform.isDesktop) return child;

    final controls = switch (platform) {
      AppPlatform.windows => WindowsWindowControls(controller: controller),
      AppPlatform.linux => LinuxWindowControls(controller: controller),
      AppPlatform.macos => null,
      AppPlatform.android || AppPlatform.ios => null,
    };
    final leadingInset = platform == AppPlatform.macos ? 82.0 : 10.0;
    final trailingInset = switch (platform) {
      AppPlatform.windows => 148.0,
      AppPlatform.linux => 136.0,
      _ => 10.0,
    };

    return Column(
      children: [
        GestureDetector(
          key: Key(switch (platform) {
            AppPlatform.macos => 'macos-title-bar',
            AppPlatform.windows => 'windows-title-bar',
            AppPlatform.linux => 'linux-title-bar',
            _ => 'desktop-title-bar',
          }),
          behavior: HitTestBehavior.translucent,
          onPanStart: (_) => controller.startDragging(),
          onDoubleTap: controller.toggleMaximize,
          child: Container(
            key: const Key('desktop-title-bar'),
            height: 38,
            decoration: BoxDecoration(
              color: AppTokens.of(context).surface,
              border: Border(
                bottom: BorderSide(color: AppTokens.of(context).borderSoft),
              ),
            ),
            child: Stack(
              children: [
                if (platform == AppPlatform.macos)
                  const SizedBox(
                    key: Key('macos-traffic-light-safe-area'),
                    width: 82,
                    height: 38,
                  ),
                DesktopTitleContent(
                  location: location,
                  leadingInset: leadingInset,
                  trailingInset: trailingInset,
                  onBack: onBack,
                  onSearch: onSearch,
                ),
                if (controls != null)
                  Positioned(right: 0, top: 0, bottom: 0, child: controls),
              ],
            ),
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}
