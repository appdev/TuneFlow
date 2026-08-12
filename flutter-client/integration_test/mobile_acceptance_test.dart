import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/app/app.dart';
import 'package:musicfree_service_client/design/components/playlist_card.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';

final class _MemoryPreferences implements AppPreferences {
  _MemoryPreferences(this.settings);
  AppSettings settings;

  @override
  Future<void> clearOrigin() async {
    settings = settings.copyWith(clearOrigin: true);
  }

  @override
  Future<AppSettings> read() async => settings;

  @override
  Future<void> write(AppSettings value) async => settings = value;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const origin = String.fromEnvironment('LX_SERVICE_ORIGIN');

  testWidgets('Service-backed mobile scope works across routes and lifecycle', (
    tester,
  ) async {
    expect(
      origin,
      isNotEmpty,
      reason: 'Pass --dart-define=LX_SERVICE_ORIGIN=.',
    );
    final preferences = _MemoryPreferences(AppSettings(origin: origin));
    await tester.pumpWidget(MusicFreeServiceApp(preferences: preferences));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-route')), findsOneWidget);
    await tester.tap(find.text('搜索').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('search-field')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('search-field')), '周杰伦');
    await tester.tap(find.byKey(const Key('search-button')));
    await tester.pumpAndSettle();
    expect(find.byTooltip('播放'), findsWidgets);

    await tester.tap(find.byTooltip('播放').first);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('mini-player')), findsOneWidget);
    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('player-route')), findsOneWidget);
    for (final state in const [
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
      await tester.pump();
    }

    await tester.tap(find.text('歌单').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('playlists-screen')), findsOneWidget);
    final playlistName =
        'Flutter acceptance ${DateTime.now().microsecondsSinceEpoch}';
    await tester.tap(find.byKey(const Key('create-playlist')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('playlist-name-field')),
      playlistName,
    );
    await tester.tap(find.text('创建').last);
    await tester.pumpAndSettle();
    expect(find.text(playlistName), findsOneWidget);
    final createdCard = find.ancestor(
      of: find.text(playlistName),
      matching: find.byType(PlaylistCard),
    );
    final createdKey = tester.widget<PlaylistCard>(createdCard).key!;
    String? playlistId = (createdKey as ValueKey<String>).value.substring(
      'playlist-'.length,
    );
    final cleanupRepository = PlaylistRepository(
      ServiceApi(ServiceOrigin.parse(origin)),
    );
    addTearDown(() async {
      if (playlistId case final id?) {
        try {
          await cleanupRepository.delete(id);
        } on Object {
          // The UI may already have deleted the acceptance fixture.
        }
      }
    });

    await tester.tap(find.text(playlistName));
    await tester.pumpAndSettle();
    expect(find.text('歌单中还没有歌曲'), findsOneWidget);
    await cleanupRepository.delete(playlistId);
    playlistId = null;

    await tester.tap(find.text('下载').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('downloads-route')), findsOneWidget);

    await tester.tap(find.text('设置').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('settings-route')), findsOneWidget);
    expect(find.textContaining('插件'), findsNothing);
    await tester.tap(find.text('保持屏幕常亮'));
    await tester.pumpAndSettle();
    expect(preferences.settings.keepAwake, isTrue);

    await tester.ensureVisible(find.text('断开连接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('断开连接'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('connection-route')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('service-origin-field')),
      origin,
    );
    await tester.tap(find.byKey(const Key('connect-button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-route')), findsOneWidget);
  });
}
