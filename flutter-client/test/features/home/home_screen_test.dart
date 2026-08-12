import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/home/home_controller.dart';
import 'package:musicfree_service_client/features/home/home_screen.dart';
import 'package:musicfree_service_client/features/library/library_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: ShadAppBuilder(child: child),
  ),
);

void main() {
  testWidgets('shows dashboard shortcuts and playlist summary', (tester) async {
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient(
        (request) async => http.Response(
          jsonEncode({
            'data': request.url.path.endsWith('playlists')
                ? [
                    {'id': 'one', 'name': 'One'},
                    {'id': 'two', 'name': 'Two'},
                  ]
                : <Object?>[],
          }),
          200,
        ),
      ),
    );
    final controller = HomeController(
      playlists: PlaylistRepository(api),
      downloads: DownloadRepository(api),
      library: LibraryRepository(api),
    );
    await controller.refresh();

    await tester.pumpWidget(
      harness(
        HomeScreen(
          controller: controller,
          onSearch: () {},
          onPlaylists: () {},
          onDownloads: () {},
          onSettings: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('home-search')), findsOneWidget);
    expect(find.byKey(const Key('home-downloads')), findsOneWidget);
    expect(find.byKey(const Key('home-settings')), findsOneWidget);
    expect(find.text('我的歌单'), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('home-search'))).height,
      greaterThanOrEqualTo(48),
    );
    expect(find.byKey(const Key('home-wide-layout')), findsOneWidget);
  });

  testWidgets('mobile home uses an immersive gallery composition', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient(
        (_) async => http.Response(jsonEncode({'data': <Object?>[]}), 200),
      ),
    );
    final controller = HomeController(
      playlists: PlaylistRepository(api),
      downloads: DownloadRepository(api),
      library: LibraryRepository(api),
    );
    await controller.refresh();

    await tester.pumpWidget(
      harness(
        HomeScreen(
          controller: controller,
          onSearch: () {},
          onPlaylists: () {},
          onDownloads: () {},
          onSettings: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('home-mobile-layout')), findsOneWidget);
    expect(find.text('开始听音乐'), findsOneWidget);
    expect(find.text('晚风'), findsNothing);
    expect(find.text('音源元数据已更新，缓存音乐仍可播放。'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('home renders Service content instead of fixed demo copy', (
    tester,
  ) async {
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient((request) async {
        final data = switch (request.url.path) {
          '/api/v1/downloads' => [
            {
              'id': 'download-dynamic',
              'status': 'completed',
              'musicInfo': {
                'id': 'dynamic-track',
                'name': '来自 Service 的歌',
                'singer': '真实歌手',
                'source': 'tx',
                'pic': 'https://example.com/cover.jpg',
              },
              'quality': 'flac',
              'extension': 'flac',
              'fileName': 'dynamic.flac',
              'downloaded': 2048,
              'total': 2048,
              'progress': 100,
              'createdAt': 1000,
              'updatedAt': 2000,
            },
          ],
          '/api/v1/library/tracks' => [
            {
              'id': 'local-track',
              'musicInfo': {
                'id': 'local-track',
                'name': '本地歌曲',
                'singer': '本地歌手',
                'source': 'local',
              },
              'size': 4096,
              'extension': 'flac',
              'streamUrl': '/api/v1/library/tracks/local-track/stream',
            },
          ],
          _ => <Object?>[],
        };
        return http.Response(
          jsonEncode({'data': data}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final controller = HomeController(
      playlists: PlaylistRepository(api),
      downloads: DownloadRepository(api),
      library: LibraryRepository(api),
    );
    await controller.refresh();
    expect(controller.state.error, isNull, reason: '${controller.state.error}');
    expect(controller.state.featured.first.title, '来自 Service 的歌');
    expect(controller.state.library.single.track.title, '本地歌曲');

    await tester.pumpWidget(
      harness(
        HomeScreen(
          controller: controller,
          onSearch: () {},
          onPlaylists: () {},
          onDownloads: () {},
          onSettings: () {},
        ),
      ),
    );
    expect(find.text('来自 Service 的歌'), findsWidgets);
    expect(find.text('真实歌手'), findsWidgets);
    expect(find.text('最近下载'), findsOneWidget);
    expect(find.text('1 首本地音乐'), findsOneWidget);
    expect(find.textContaining('伍佰'), findsNothing);
    expect(find.text('让声音\n占据房间。'), findsNothing);
  });
}
