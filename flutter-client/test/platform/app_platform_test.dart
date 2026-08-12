import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/platform/app_platform.dart';

void main() {
  test('maps every supported Flutter target to an app platform', () {
    expect(resolveAppPlatform(TargetPlatform.macOS), AppPlatform.macos);
    expect(resolveAppPlatform(TargetPlatform.windows), AppPlatform.windows);
    expect(resolveAppPlatform(TargetPlatform.linux), AppPlatform.linux);
    expect(resolveAppPlatform(TargetPlatform.android), AppPlatform.android);
    expect(resolveAppPlatform(TargetPlatform.iOS), AppPlatform.ios);
  });

  test('rejects unsupported Flutter targets', () {
    expect(
      () => resolveAppPlatform(TargetPlatform.fuchsia),
      throwsUnsupportedError,
    );
  });

  test('classifies desktop and mobile platforms', () {
    expect(AppPlatform.macos.isDesktop, isTrue);
    expect(AppPlatform.windows.isDesktop, isTrue);
    expect(AppPlatform.linux.isDesktop, isTrue);
    expect(AppPlatform.android.isDesktop, isFalse);
    expect(AppPlatform.ios.isDesktop, isFalse);
  });
}
