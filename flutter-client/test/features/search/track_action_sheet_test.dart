import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/search/search_track_metadata.dart';
import 'package:musicfree_service_client/features/search/track_action.dart';
import 'package:musicfree_service_client/features/search/track_action_sheet.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

void main() {
  testWidgets('renders the complete shared action list', (tester) async {
    final calls = <TrackActionId>[];
    final track = Track.fromJson({
      'id': 'one',
      'name': 'One',
      'singer': 'Artist',
      'source': 'kw',
      'types': ['flac'],
    });
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
        TrackActionSheet(
          track: track,
          metadata: SearchTrackMetadata.fromTrack(track),
          actions: actions,
        ),
      ),
    );

    for (final id in TrackActionId.values) {
      await tester.tap(find.byKey(Key('track-action-${id.name}')));
      await tester.pump();
    }

    expect(calls, TrackActionId.values);
    expect(find.text('Artist'), findsOneWidget);
    expect(find.text('无损'), findsOneWidget);
  });
}
