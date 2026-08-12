import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/design/app_breakpoints.dart';
import 'package:musicfree_service_client/design/design_tokens.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

void main() {
  testWidgets('buildDarkTheme exposes a dark Zinc color scheme', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        darkTheme: buildDarkTheme(),
        themeMode: ThemeMode.dark,
        home: Builder(
          builder: (context) => ColoredBox(
            key: const Key('theme-probe'),
            color: ShadTheme.of(context).colorScheme.background,
          ),
        ),
      ),
    );

    final context = tester.element(find.byKey(const Key('theme-probe')));
    final theme = ShadTheme.of(context);
    expect(theme.brightness, Brightness.dark);
    expect(theme.colorScheme.background, AppTokens.dark.background);
  });

  testWidgets('light and dark themes expose distinct semantic surfaces', (
    tester,
  ) async {
    Future<AppTokens> render(ThemeMode mode) async {
      late AppTokens tokens;
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        ShadApp(
          key: ValueKey(mode),
          theme: buildLightTheme(),
          darkTheme: buildDarkTheme(),
          themeMode: mode,
          home: Builder(
            builder: (context) {
              tokens = AppTokens.of(context);
              return const SizedBox();
            },
          ),
        ),
      );
      return tokens;
    }

    final light = await render(ThemeMode.light);
    final dark = await render(ThemeMode.dark);

    expect(light.background, isNot(dark.background));
    expect(light.focusRing.computeLuminance(), greaterThan(0));
    expect(dark.danger, isNot(dark.warning));
    expect(dark.foreground, isNot(dark.foregroundSecondary));
  });

  test('layout classes match accepted viewports', () {
    expect(classifyLayout(390), AppLayoutClass.mobile);
    expect(classifyLayout(1024), AppLayoutClass.narrow);
    expect(classifyLayout(1440), AppLayoutClass.desktop);
  });
}
