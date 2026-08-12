import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/playlists/playlist_detail_controller.dart';
import 'package:musicfree_service_client/features/playlists/playlist_detail_screen.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

void main() {
  testWidgets('renders playlist metadata from the Service detail', (
    tester,
  ) async {
    final repository = PlaylistRepository(
      ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'data': {
                'id': 'remote-mix',
                'name': 'Remote Mix',
                'tracks': [
                  {'id': 'one', 'name': 'One', 'singer': 'Artist A'},
                  {
                    'id': 'two',
                    'name': 'Two',
                    'singer': 'Artist B',
                    'img': 'https://cdn.example.test/two.jpg',
                  },
                ],
              },
            }),
            200,
          ),
        ),
      ),
    );

    await tester.pumpWidget(
      harness(
        PlaylistDetailScreen(
          controller: PlaylistDetailController(repository, 'remote-mix'),
          playTracks: (tracks, {startIndex = 0}) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Remote Mix'), findsWidgets);
    expect(find.textContaining('2 首'), findsWidgets);
    expect(find.textContaining('24 首'), findsNothing);
    expect(find.textContaining('伍佰 & China Blue 的夜路'), findsNothing);
    expect(find.byType(Image), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}
