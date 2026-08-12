import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_exception.dart';
import 'package:musicfree_service_client/app/app_providers.dart';
import 'package:musicfree_service_client/features/connection/connection_controller.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';

final class MemoryAppPreferences implements AppPreferences {
  AppSettings settings = const AppSettings();

  @override
  Future<void> clearOrigin() async {
    settings = settings.copyWith(clearOrigin: true);
  }

  @override
  Future<AppSettings> read() async => settings;

  @override
  Future<void> write(AppSettings value) async => settings = value;
}

ConnectionRepository healthyRepository() => ConnectionRepository(
  (origin) => ServiceApi(
    origin,
    client: MockClient(
      (request) async => http.Response(
        jsonEncode({
          'data': request.url.path.endsWith('health')
              ? {'status': 'ok'}
              : {
                  'runtime': 'service',
                  'apiVersion': 'v1',
                  'features': <String, Object?>{},
                },
        }),
        200,
      ),
    ),
  ),
);

void main() {
  test(
    'connection diagnostics measure latency and retain API version',
    () async {
      final repository = healthyRepository();

      final diagnostics = await repository.diagnostics('http://service.local');

      expect(diagnostics.connected, isTrue);
      expect(diagnostics.latency, greaterThanOrEqualTo(Duration.zero));
      expect(diagnostics.apiVersion, 'v1');
      expect(diagnostics.origin, 'http://service.local');
    },
  );

  test('connection probe times out instead of loading forever', () async {
    final repository = ConnectionRepository(
      (origin) => ServiceApi(
        origin,
        client: MockClient((request) => Completer<http.Response>().future),
      ),
      const Duration(milliseconds: 10),
    );

    await expectLater(
      repository.connect('http://service.local'),
      throwsA(
        isA<ServiceException>().having(
          (error) => error.code,
          'code',
          'CONNECTION_TIMEOUT',
        ),
      ),
    );
  });

  test('restores a persisted Service connection', () async {
    final preferences = MemoryAppPreferences()
      ..settings = const AppSettings(origin: 'http://service.local');
    final container = ProviderContainer(
      overrides: [
        appPreferencesProvider.overrideWithValue(preferences),
        connectionRepositoryProvider.overrideWithValue(healthyRepository()),
      ],
    );
    addTearDown(container.dispose);

    final connected = await container.read(connectionProvider.future);

    expect(connected?.origin.uri.toString(), 'http://service.local');
  });

  test(
    'connect persists the normalized origin and disconnect preserves UI settings',
    () async {
      final preferences = MemoryAppPreferences()
        ..settings = const AppSettings(
          themeMode: ThemeMode.dark,
          language: AppLanguage.zh,
        );
      final container = ProviderContainer(
        overrides: [
          appPreferencesProvider.overrideWithValue(preferences),
          connectionRepositoryProvider.overrideWithValue(healthyRepository()),
        ],
      );
      addTearDown(container.dispose);
      await container.read(connectionProvider.future);

      await container
          .read(connectionProvider.notifier)
          .connect('http://service.local/');
      expect(preferences.settings.origin, 'http://service.local');

      await container.read(connectionProvider.notifier).disconnect();
      expect(container.read(connectionProvider).value, isNull);
      expect(preferences.settings.origin, isNull);
      expect(preferences.settings.themeMode, ThemeMode.dark);
      expect(preferences.settings.language, AppLanguage.zh);
    },
  );
}
