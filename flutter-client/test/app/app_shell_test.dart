import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/app/app.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../support/memory_app_preferences.dart';

void main() {
  testWidgets('applies persisted dark theme and English locale', (
    tester,
  ) async {
    await tester.pumpWidget(
      MusicFreeServiceApp(
        preferences: MemoryAppPreferences(
          const AppSettings(
            themeMode: ThemeMode.dark,
            language: AppLanguage.en,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final context = tester.element(find.byKey(const Key('connection-route')));
    expect(ShadTheme.of(context).brightness, Brightness.dark);
    expect(find.text('Connect to TuneFlow Service'), findsOneWidget);
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).onGenerateTitle!(
        context,
      ),
      'TuneFlow',
    );
  });

  testWidgets('connects and enters the route-based home shell', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(1440, 960);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final preferences = MemoryAppPreferences(
      const AppSettings(language: AppLanguage.en),
    );
    final repository = ConnectionRepository(
      (origin) => ServiceApi(
        origin,
        client: MockClient((request) async {
          final path = request.url.path;
          final value = switch (path) {
            '/api/v1/health' => {'status': 'ok'},
            '/api/v1/capabilities' => {
              'runtime': 'service',
              'apiVersion': 'v1',
              'features': <String, Object?>{},
            },
            '/api/v1/events/snapshot' => {'sequence': 0, 'events': <Object?>[]},
            '/api/v1/playlists' => <Object?>[],
            '/api/v1/downloads' => <Object?>[],
            _ => <Object?>[],
          };
          return http.Response(jsonEncode({'data': value}), 200);
        }),
      ),
    );

    await tester.pumpWidget(
      MusicFreeServiceApp(
        connectionRepository: repository,
        preferences: preferences,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ShadApp), findsOneWidget);
    expect(find.byKey(const Key('connection-route')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('service-origin-field')),
      'http://service.local',
    );
    await tester.tap(find.byKey(const Key('connect-button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-route')), findsOneWidget);
    expect(find.byKey(const Key('main-shell')), findsOneWidget);
    expect(find.byKey(const Key('desktop-navigation')), findsOneWidget);
    expect(find.byKey(const Key('desktop-persistent-player')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('desktop-persistent-player'))).height,
      0,
      reason: 'an empty desktop player must not reserve shell space',
    );
    expect(
      tester.getSize(find.byKey(const Key('desktop-title-bar'))).height,
      38,
    );
    expect(
      tester.getSize(find.byKey(const Key('desktop-navigation'))).width,
      208,
    );
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('Home · TuneFlow'), findsOneWidget);
    expect(preferences.settings.origin, 'http://service.local');

    expect(find.byKey(const Key('macos-title-bar')), findsOneWidget);
    expect(find.byKey(const Key('window-minimize')), findsNothing);
    expect(find.byKey(const Key('window-maximize')), findsNothing);
    expect(find.byKey(const Key('window-close')), findsNothing);

    await tester.tap(find.text('搜索').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('search-field')), findsOneWidget);

    await tester.tap(find.text('下载管理').last);
    await tester.pumpAndSettle();
    expect(find.text('暂无 Service 下载任务'), findsOneWidget);

    await tester.tap(find.text('设置').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('settings-route')), findsOneWidget);
    expect(find.textContaining('插件'), findsNothing);
    expect(find.textContaining('文件夹'), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('mobile shell uses compact player and five destinations', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = ConnectionRepository(
      (origin) => ServiceApi(
        origin,
        client: MockClient((request) async {
          final value = switch (request.url.path) {
            '/api/v1/health' => {'status': 'ok'},
            '/api/v1/capabilities' => {
              'runtime': 'service',
              'apiVersion': 'v1',
              'features': <String, Object?>{},
            },
            '/api/v1/events/snapshot' => {'sequence': 0, 'events': <Object?>[]},
            _ => <Object?>[],
          };
          return http.Response(jsonEncode({'data': value}), 200);
        }),
      ),
    );

    await tester.pumpWidget(
      MusicFreeServiceApp(
        connectionRepository: repository,
        preferences: MemoryAppPreferences(
          const AppSettings(origin: 'http://service.local'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mobile-bottom-navigation')), findsOneWidget);
    expect(find.byKey(const Key('mobile-mini-player')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('mobile-mini-player'))).height,
      0,
      reason: 'an empty mobile player must not reserve shell space',
    );
    expect(
      tester.getSize(find.byKey(const Key('mobile-bottom-navigation'))).height,
      58,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('mobile-bottom-navigation')),
        matching: find.text('我的音乐'),
      ),
      findsOneWidget,
    );
  });
}
