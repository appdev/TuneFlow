import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/settings/settings_controller.dart';
import 'package:musicfree_service_client/features/settings/settings_screen.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

void main() {
  testWidgets('shows only approved Service-client settings', (tester) async {
    final controller = SettingsController(
      settings: const AppSettings(origin: 'http://service.local'),
      save: (_) async {},
      connect: (_) async {},
      disconnect: () async {},
      setPlayerQuality: (_) async {},
    );

    await tester.pumpWidget(harness(SettingsScreen(controller: controller)));

    for (final label in const ['主题', '默认音质']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.textContaining('插件'), findsNothing);
    expect(find.textContaining('文件权限'), findsNothing);
    expect(find.byKey(const Key('settings-wide-layout')), findsOneWidget);
  });
}
