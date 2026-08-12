import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlists_controller.dart';
import 'package:musicfree_service_client/features/playlists/playlists_screen.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: ShadAppBuilder(child: child),
  ),
);

void main() {
  testWidgets('renders playlist cards and delegates detail navigation', (
    tester,
  ) async {
    final repository = PlaylistRepository(
      ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient(
          (request) async => http.Response(
            jsonEncode({
              'data': request.url.path == '/api/v1/playlists'
                  ? [
                      {'id': 'love', 'name': 'list__name_love'},
                    ]
                  : {
                      'id': 'love',
                      'name': 'love',
                      'tracks': [
                        {
                          'id': 'one',
                          'name': 'One',
                          'source': 'kw',
                          'img': 'https://cdn.example.test/one.jpg',
                        },
                        {'id': 'two', 'name': 'Two', 'source': 'kw'},
                      ],
                    },
            }),
            200,
          ),
        ),
      ),
    );
    final controller = PlaylistsController(repository);
    await controller.refresh();
    String? opened;

    await tester.pumpWidget(
      harness(
        PlaylistsScreen(controller: controller, onOpen: (id) => opened = id),
      ),
    );
    await tester.tap(find.byKey(const Key('playlist-love')));

    expect(opened, 'love');
    expect(find.text('我的收藏'), findsOneWidget);
    expect(find.text('2 首'), findsOneWidget);
    expect(find.text('本地收藏'), findsNothing);
    expect(find.text('本地歌单'), findsNothing);
    expect(find.byKey(const Key('create-playlist')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('create-playlist'))).height,
      greaterThanOrEqualTo(48),
    );
    expect(find.byKey(const Key('playlists-gallery-wide')), findsOneWidget);
  });
}
