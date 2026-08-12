import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/platform/app_platform.dart';
import 'package:musicfree_service_client/platform/desktop_window_bootstrap.dart';
import 'package:window_manager/window_manager.dart';

void main() {
  test('initializes desktop plugins only for desktop platforms', () {
    expect(shouldInitializeDesktopWindow(AppPlatform.macos), isTrue);
    expect(shouldInitializeDesktopWindow(AppPlatform.windows), isTrue);
    expect(shouldInitializeDesktopWindow(AppPlatform.linux), isTrue);
    expect(shouldInitializeDesktopWindow(AppPlatform.android), isFalse);
    expect(shouldInitializeDesktopWindow(AppPlatform.ios), isFalse);
  });

  test('uses frameless TuneFlow options with a safe minimum size', () {
    for (final platform in [
      AppPlatform.macos,
      AppPlatform.windows,
      AppPlatform.linux,
    ]) {
      final options = desktopWindowOptions(platform);
      expect(options.title, 'TuneFlow');
      expect(options.titleBarStyle, TitleBarStyle.hidden);
      expect(options.minimumSize, const Size(960, 640));
      expect(options.center, isTrue);
    }
  });

  test('rejects desktop options for mobile platforms', () {
    expect(
      () => desktopWindowOptions(AppPlatform.android),
      throwsArgumentError,
    );
    expect(() => desktopWindowOptions(AppPlatform.ios), throwsArgumentError);
  });
}
