import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/app/app_shell.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/downloads/downloads_screen.dart';
import 'package:musicfree_service_client/features/home/home_screen.dart';
import 'package:musicfree_service_client/features/player/player_screen.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/search/search_controller.dart';
import 'package:musicfree_service_client/features/search/search_screen.dart';
import 'package:musicfree_service_client/features/search/search_track_artwork.dart';
import 'package:musicfree_service_client/features/player/player_controller.dart';
import 'package:musicfree_service_client/l10n/app_localizations.dart';
import 'package:musicfree_service_client/platform/app_platform.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'high_fidelity_fixtures.dart';

void configureViewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
}

Widget shellHarness({
  required String path,
  required Widget child,
  required PlayerController player,
  ThemeMode themeMode = ThemeMode.dark,
}) {
  final api = fixtureApi();
  final connected = ConnectedService(
    origin: ServiceOrigin.parse('http://service.local'),
    api: api,
    capabilities: const Capabilities(
      runtime: 'service',
      apiVersion: 'v1',
      features: {},
    ),
  );
  final router = GoRouter(
    initialLocation: path,
    routes: [
      GoRoute(
        path: path,
        builder: (context, state) => AppShell(
          connected: connected,
          onDisconnect: () {},
          player: player,
          platform: AppPlatform.macos,
          child: child,
        ),
      ),
    ],
  );
  return ShadApp.custom(
    theme: buildLightTheme(),
    darkTheme: buildDarkTheme(),
    themeMode: themeMode,
    appBuilder: (context) => MaterialApp.router(
      debugShowCheckedModeBanner: false,
      theme: Theme.of(context),
      locale: const Locale('zh'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: router,
      builder: (context, child) => ShadAppBuilder(child: child!),
    ),
  );
}

void main() {
  setUpAll(() async {
    final chineseFontLoader = FontLoader('NotoSansCJKsc')
      ..addFont(rootBundle.load('assets/fonts/NotoSansCJKsc-Regular.otf'));
    final iconLoader = FontLoader('packages/lucide_icons_flutter/Lucide')
      ..addFont(
        rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
      );
    await Future.wait([chineseFontLoader.load(), iconLoader.load()]);
  });

  testWidgets('home desktop dark', (tester) async {
    configureViewport(tester, const Size(1440, 960));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixtureHomeController();
    final player = await fixturePlayerController();
    await tester.pumpWidget(
      shellHarness(
        path: '/',
        player: player,
        child: HomeScreen(
          controller: controller,
          onSearch: () {},
          onPlaylists: () {},
          onDownloads: () {},
          onSettings: () {},
          player: player,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/home-desktop-dark.png'),
    );
  });

  testWidgets('search narrow dark', (tester) async {
    configureViewport(tester, const Size(1024, 768));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixtureSearchController();
    final player = await fixturePlayerController();
    final api = fixtureApi();
    await tester.pumpWidget(
      shellHarness(
        path: '/search',
        player: player,
        themeMode: ThemeMode.dark,
        child: SearchScreen(
          controller: controller,
          playlists: PlaylistRepository(api),
          downloads: DownloadRepository(api),
          player: player,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/search-narrow-dark.png'),
    );
  });

  testWidgets('search desktop overview dark', (tester) async {
    configureViewport(tester, const Size(1440, 900));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixtureSearchController();
    final player = await fixturePlayerController();
    final api = fixtureApi();
    await tester.pumpWidget(
      shellHarness(
        path: '/search',
        player: player,
        themeMode: ThemeMode.dark,
        child: SearchScreen(
          controller: controller,
          playlists: PlaylistRepository(api),
          downloads: DownloadRepository(api),
          player: player,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/search-desktop-overview-dark.png'),
    );
  });

  testWidgets('search mobile track list and actions light', (tester) async {
    configureViewport(tester, const Size(390, 844));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixtureSearchController();
    await controller.selectView(SearchView.tracks);
    final player = await fixturePlayerController();
    final api = fixtureApi();
    await tester.pumpWidget(
      shellHarness(
        path: '/search',
        player: player,
        themeMode: ThemeMode.light,
        child: SearchScreen(
          controller: controller,
          playlists: PlaylistRepository(api),
          downloads: DownloadRepository(api),
          player: player,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(SearchTrackArtwork), findsNothing);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/search-mobile-tracks-light.png'),
    );

    await tester.tap(find.byKey(const Key('search-more-kw-wind')));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(ShadSheet),
      matchesGoldenFile('goldens/search-mobile-actions-light.png'),
    );
  });

  testWidgets('player mobile dark', (tester) async {
    configureViewport(tester, const Size(390, 844));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixturePlayerController();
    await tester.pumpWidget(
      shellHarness(
        path: '/player',
        player: controller,
        child: PlayerScreen(
          controller: controller,
          lyricsLoader: (_) async => const Lyrics(
            original: '[00:01]晚风轻轻吹过\n[00:40]城市慢慢安静',
            translation: '[00:01]The night wind passes',
          ),
          wakeLock: NoopWakeLock(),
          keepAwake: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('歌词'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('mobile-mini-player')), findsNothing);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/player-mobile-dark.png'),
    );
  });

  testWidgets('downloads compact dark', (tester) async {
    configureViewport(tester, const Size(360, 800));
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = await fixtureDownloadsController();
    final player = await fixturePlayerController();
    await tester.pumpWidget(
      shellHarness(
        path: '/downloads',
        player: player,
        themeMode: ThemeMode.dark,
        child: DownloadsScreen(controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/downloads-compact-dark.png'),
    );
  });
}
