import 'package:flutter/foundation.dart';

enum AppPlatform { macos, windows, linux, android, ios }

extension AppPlatformCategory on AppPlatform {
  bool get isDesktop => switch (this) {
    AppPlatform.macos || AppPlatform.windows || AppPlatform.linux => true,
    AppPlatform.android || AppPlatform.ios => false,
  };
}

AppPlatform resolveAppPlatform(TargetPlatform platform) => switch (platform) {
  TargetPlatform.macOS => AppPlatform.macos,
  TargetPlatform.windows => AppPlatform.windows,
  TargetPlatform.linux => AppPlatform.linux,
  TargetPlatform.android => AppPlatform.android,
  TargetPlatform.iOS => AppPlatform.ios,
  TargetPlatform.fuchsia => throw UnsupportedError(
    'TuneFlow does not support Fuchsia.',
  ),
};
