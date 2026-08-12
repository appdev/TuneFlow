import 'package:flutter/material.dart';
import 'package:macos_window_utils/macos_window_utils.dart';
import 'package:window_manager/window_manager.dart';

import 'app_platform.dart';
import 'desktop_window_controller.dart';

bool shouldInitializeDesktopWindow(AppPlatform platform) => platform.isDesktop;

WindowOptions desktopWindowOptions(AppPlatform platform) {
  if (!platform.isDesktop) {
    throw ArgumentError.value(platform, 'platform', 'must be a desktop');
  }
  return WindowOptions(
    size: const Size(1240, 820),
    minimumSize: const Size(960, 640),
    center: true,
    backgroundColor: Colors.transparent,
    title: 'TuneFlow',
    titleBarStyle: TitleBarStyle.hidden,
    windowButtonVisibility: platform == AppPlatform.macos,
  );
}

Future<void> initializeDesktopWindow(AppPlatform platform) async {
  if (!shouldInitializeDesktopWindow(platform)) return;

  try {
    await windowManager.ensureInitialized();
    if (platform == AppPlatform.macos) {
      await WindowManipulator.initialize();
      await WindowManipulator.makeTitlebarTransparent();
      await WindowManipulator.enableFullSizeContentView();
      await WindowManipulator.showCloseButton();
      await WindowManipulator.showMiniaturizeButton();
      await WindowManipulator.showZoomButton();
    }
    await windowManager.waitUntilReadyToShow(
      desktopWindowOptions(platform),
      () async {
        await desktopWindowController.attach();
        await windowManager.show();
        await windowManager.focus();
      },
    );
  } catch (error, stackTrace) {
    debugPrint('TuneFlow desktop window initialization failed: $error');
    debugPrintStack(stackTrace: stackTrace);
  }
}
