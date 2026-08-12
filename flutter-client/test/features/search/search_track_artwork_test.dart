import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/search/search_track_artwork.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

void main() {
  testWidgets('uses response artwork without requesting fallback', (
    tester,
  ) async {
    var calls = 0;
    final track = Track.fromJson({
      'id': 'one',
      'name': 'One',
      'source': 'tx',
      'img': 'https://example.test/one.jpg',
    });
    await tester.pumpWidget(
      harness(
        SearchTrackArtwork(
          track: track,
          loadPicture: (_) async {
            calls++;
            return null;
          },
        ),
      ),
    );
    await tester.pump();

    expect(calls, 0);
  });

  testWidgets('requests missing artwork once then shows initial fallback', (
    tester,
  ) async {
    var calls = 0;
    final track = Track.fromJson({'id': 'one', 'name': '晴天', 'source': 'tx'});
    final widget = SearchTrackArtwork(
      track: track,
      loadPicture: (_) async {
        calls++;
        return null;
      },
    );
    await tester.pumpWidget(harness(widget));
    await tester.pump();
    await tester.pumpWidget(harness(widget));
    await tester.pump();

    expect(calls, 1);
    expect(
      find.byKey(const Key('search-artwork-fallback-tx-one')),
      findsOneWidget,
    );
    expect(find.text('晴'), findsOneWidget);
  });
}
