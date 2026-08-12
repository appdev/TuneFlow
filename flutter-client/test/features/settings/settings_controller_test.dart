import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';
import 'package:musicfree_service_client/features/settings/settings_controller.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';

void main() {
  test(
    'updates every approved preference and delegates connection intents',
    () async {
      var saved = const AppSettings(origin: 'http://old.local');
      final connections = <String>[];
      var disconnects = 0;
      final qualities = <String>[];
      final controller = SettingsController(
        settings: saved,
        save: (value) async => saved = value,
        connect: (origin) async => connections.add(origin),
        disconnect: () async => disconnects++,
        setPlayerQuality: (quality) async => qualities.add(quality),
      );

      await controller.setThemeMode(ThemeMode.dark);
      await controller.setLanguage(AppLanguage.en);
      await controller.setQuality(PlaybackQuality.high320k);
      await controller.setKeepAwake(true);
      await controller.setShowLyrics(true);
      await controller.replaceOrigin('http://new.local/');
      await controller.disconnect();

      expect(saved.themeMode, ThemeMode.dark);
      expect(saved.language, AppLanguage.en);
      expect(saved.quality, PlaybackQuality.high320k);
      expect(saved.keepAwake, isTrue);
      expect(saved.showLyrics, isTrue);
      expect(qualities, ['320k']);
      expect(connections, ['http://new.local']);
      expect(disconnects, 1);
    },
  );

  test(
    'settings retain connection diagnostics for the active origin',
    () async {
      final controller = SettingsController(
        settings: const AppSettings(origin: 'http://service.local'),
        save: (_) async {},
        connect: (_) async {},
        disconnect: () async {},
        setPlayerQuality: (_) async {},
        diagnostics: (origin) async => ConnectionDiagnostics(
          origin: origin,
          connected: true,
          latency: const Duration(milliseconds: 12),
          apiVersion: 'v1',
          checkedAt: DateTime.fromMillisecondsSinceEpoch(1),
        ),
      );

      await controller.refreshDiagnostics();

      expect(controller.connection?.latency, const Duration(milliseconds: 12));
      expect(controller.connection?.apiVersion, 'v1');
      expect(controller.diagnosticsError, isNull);
    },
  );
}
