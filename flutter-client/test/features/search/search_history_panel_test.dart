import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/search/search_history_panel.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(
      body: ShadAppBuilder(child: Center(child: child)),
    ),
  ),
);

void main() {
  testWidgets('history panel exposes selection removal and clear actions', (
    tester,
  ) async {
    String? selected;
    String? removed;
    var cleared = 0;

    await tester.pumpWidget(
      harness(
        SizedBox(
          width: 610,
          child: SearchHistoryPanel(
            items: const ['晚风', '挪威的森林'],
            mobile: false,
            onSelected: (value) => selected = value,
            onRemoved: (value) => removed = value,
            onCleared: () => cleared += 1,
          ),
        ),
      ),
    );

    expect(find.text('搜索历史'), findsOneWidget);
    expect(find.text('晚风'), findsOneWidget);
    expect(find.text('挪威的森林'), findsOneWidget);

    await tester.tap(find.byKey(const Key('search-history-item-0')));
    expect(selected, '晚风');
    await tester.tap(find.byKey(const Key('search-history-remove-0')));
    expect(removed, '晚风');
    await tester.tap(find.byKey(const Key('search-history-clear')));
    expect(cleared, 1);
  });

  testWidgets('mobile history panel is inline without a desktop shadow', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness(
        SizedBox(
          width: 390,
          child: SearchHistoryPanel(
            items: const ['晚风'],
            mobile: true,
            onSelected: (_) {},
            onRemoved: (_) {},
            onCleared: () {},
          ),
        ),
      ),
    );

    final panel = tester.widget<Container>(
      find.byKey(const Key('search-history-panel')),
    );
    final decoration = panel.decoration! as BoxDecoration;
    expect(decoration.boxShadow, isNull);
  });
}
