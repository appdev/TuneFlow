import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

void main() {
  setUp(() {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty();
  });

  test('uses safe defaults when no preferences exist', () async {
    final settings = await SharedAppPreferences().read();

    expect(settings.origin, isNull);
    expect(settings.themeMode, ThemeMode.system);
    expect(settings.language, AppLanguage.system);
    expect(settings.quality, PlaybackQuality.low128k);
    expect(settings.keepAwake, isFalse);
    expect(settings.showLyrics, isFalse);
  });

  test('round trips approved preferences', () async {
    final preferences = SharedAppPreferences();
    const expected = AppSettings(
      origin: 'http://service.local',
      themeMode: ThemeMode.dark,
      language: AppLanguage.zh,
      quality: PlaybackQuality.high320k,
      keepAwake: true,
      showLyrics: true,
    );

    await preferences.write(expected);

    expect(await preferences.read(), expected);
  });

  test('clearOrigin preserves every non-origin preference', () async {
    final preferences = SharedAppPreferences();
    const expected = AppSettings(
      origin: 'http://service.local',
      themeMode: ThemeMode.light,
      language: AppLanguage.en,
      quality: PlaybackQuality.lossless,
      keepAwake: true,
      showLyrics: true,
    );
    await preferences.write(expected);

    await preferences.clearOrigin();

    expect(await preferences.read(), expected.copyWith(clearOrigin: true));
  });

  test('playback quality maps to Service API values', () {
    expect(PlaybackQuality.low128k.apiValue, '128k');
    expect(PlaybackQuality.high320k.apiValue, '320k');
    expect(PlaybackQuality.lossless.apiValue, 'flac');
  });
}
