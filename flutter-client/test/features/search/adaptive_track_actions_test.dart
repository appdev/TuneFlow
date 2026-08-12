import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/search/adaptive_track_actions.dart';
import 'package:musicfree_service_client/features/search/track_action.dart';
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
  testWidgets('desktop popover and context menu share the same actions', (
    tester,
  ) async {
    final calls = <TrackActionId>[];
    final actions = TrackActionId.values
        .map(
          (id) => TrackAction(
            id: id,
            label: id.name,
            icon: LucideIcons.music,
            invoke: () async => calls.add(id),
          ),
        )
        .toList();
    await tester.pumpWidget(
      harness(
        DesktopTrackContextRegion(
          actions: actions,
          child: DesktopTrackActionsButton(
            actions: actions,
            child: (open) => IconButton(
              key: const Key('more'),
              onPressed: open,
              icon: const Icon(LucideIcons.ellipsis),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('more')));
    await tester.pumpAndSettle();
    for (final id in TrackActionId.values) {
      expect(find.text(id.name), findsOneWidget);
    }
    await tester.tap(find.text(TrackActionId.playNow.name));
    await tester.pumpAndSettle();
    expect(calls, [TrackActionId.playNow]);
  });
}
