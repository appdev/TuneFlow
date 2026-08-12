import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/l10n/app_localizations.dart';
import 'package:musicfree_service_client/platform/app_platform.dart';
import 'package:musicfree_service_client/platform/desktop_window_controller.dart';
import 'package:musicfree_service_client/platform/platform_window_frame.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

void main() {
  for (final platform in [AppPlatform.android, AppPlatform.ios]) {
    testWidgets('$platform does not render desktop window chrome', (
      tester,
    ) async {
      await tester.pumpWidget(_harness(platform));

      expect(find.byKey(const Key('window-frame-content')), findsOneWidget);
      expect(find.byKey(const Key('desktop-title-bar')), findsNothing);
      expect(find.byKey(const Key('window-close')), findsNothing);
    });
  }

  testWidgets('macOS reserves traffic-light space without Flutter controls', (
    tester,
  ) async {
    await tester.pumpWidget(_harness(AppPlatform.macos));

    expect(find.byKey(const Key('desktop-title-bar')), findsOneWidget);
    expect(find.byKey(const Key('macos-title-bar')), findsOneWidget);
    expect(
      find.byKey(const Key('macos-traffic-light-safe-area')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('window-minimize')), findsNothing);
    expect(find.byKey(const Key('window-maximize')), findsNothing);
    expect(find.byKey(const Key('window-close')), findsNothing);
  });

  for (final platform in [AppPlatform.windows, AppPlatform.linux]) {
    testWidgets('$platform renders right-side caption controls', (
      tester,
    ) async {
      await tester.pumpWidget(_harness(platform));

      expect(find.byKey(const Key('desktop-title-bar')), findsOneWidget);
      expect(
        find.byKey(
          Key(
            platform == AppPlatform.windows
                ? 'windows-title-bar'
                : 'linux-title-bar',
          ),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('window-minimize')), findsOneWidget);
      expect(find.byKey(const Key('window-maximize')), findsOneWidget);
      expect(find.byKey(const Key('window-close')), findsOneWidget);
      expect(
        tester.getSize(find.byKey(const Key('desktop-title-bar'))).height,
        38,
      );
    });
  }
}

Widget _harness(AppPlatform platform) {
  final controller = DesktopWindowController(_FakeWindowOperations());
  return ShadApp.custom(
    theme: buildLightTheme(),
    appBuilder: (context) => MaterialApp(
      theme: Theme.of(context),
      locale: const Locale('zh'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: ShadAppBuilder(
          child: PlatformWindowFrame(
            platform: platform,
            location: '/search',
            controller: controller,
            child: const ColoredBox(
              key: Key('window-frame-content'),
              color: Colors.transparent,
            ),
          ),
        ),
      ),
    ),
  );
}

final class _FakeWindowOperations implements WindowOperations {
  @override
  Future<void> close() async {}

  @override
  Future<bool> isMaximized() async => false;

  @override
  Future<void> maximize() async {}

  @override
  Future<void> minimize() async {}

  @override
  Future<void> startDragging() async {}

  @override
  Future<void> unmaximize() async {}
}
