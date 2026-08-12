import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppLanguage { system, zh, en }

enum PlaybackQuality {
  low128k('128k'),
  high320k('320k'),
  lossless('flac');

  const PlaybackQuality(this.apiValue);
  final String apiValue;
}

final class AppSettings {
  const AppSettings({
    this.origin,
    this.themeMode = ThemeMode.system,
    this.language = AppLanguage.system,
    this.quality = PlaybackQuality.low128k,
    this.keepAwake = false,
    this.showLyrics = false,
    this.showTranslation = true,
  });

  final String? origin;
  final ThemeMode themeMode;
  final AppLanguage language;
  final PlaybackQuality quality;
  final bool keepAwake;
  final bool showLyrics;
  final bool showTranslation;

  AppSettings copyWith({
    String? origin,
    bool clearOrigin = false,
    ThemeMode? themeMode,
    AppLanguage? language,
    PlaybackQuality? quality,
    bool? keepAwake,
    bool? showLyrics,
    bool? showTranslation,
  }) => AppSettings(
    origin: clearOrigin ? null : origin ?? this.origin,
    themeMode: themeMode ?? this.themeMode,
    language: language ?? this.language,
    quality: quality ?? this.quality,
    keepAwake: keepAwake ?? this.keepAwake,
    showLyrics: showLyrics ?? this.showLyrics,
    showTranslation: showTranslation ?? this.showTranslation,
  );

  @override
  bool operator ==(Object other) =>
      other is AppSettings &&
      other.origin == origin &&
      other.themeMode == themeMode &&
      other.language == language &&
      other.quality == quality &&
      other.keepAwake == keepAwake &&
      other.showLyrics == showLyrics &&
      other.showTranslation == showTranslation;

  @override
  int get hashCode => Object.hash(
    origin,
    themeMode,
    language,
    quality,
    keepAwake,
    showLyrics,
    showTranslation,
  );
}

abstract interface class AppPreferences {
  Future<AppSettings> read();
  Future<void> write(AppSettings settings);
  Future<void> clearOrigin();
}

final class SharedAppPreferences implements AppPreferences {
  SharedAppPreferences([SharedPreferencesAsync? preferences])
    : _preferences = preferences ?? SharedPreferencesAsync();

  static const _originKey = 'service_origin';
  static const _themeModeKey = 'theme_mode';
  static const _languageKey = 'language';
  static const _qualityKey = 'playback_quality';
  static const _keepAwakeKey = 'keep_awake';
  static const _showLyricsKey = 'show_lyrics';
  static const _showTranslationKey = 'show_translation';

  final SharedPreferencesAsync _preferences;

  @override
  Future<AppSettings> read() async => AppSettings(
    origin: await _preferences.getString(_originKey),
    themeMode: _enumValue(
      ThemeMode.values,
      await _preferences.getString(_themeModeKey),
      ThemeMode.system,
    ),
    language: _enumValue(
      AppLanguage.values,
      await _preferences.getString(_languageKey),
      AppLanguage.system,
    ),
    quality: _enumValue(
      PlaybackQuality.values,
      await _preferences.getString(_qualityKey),
      PlaybackQuality.low128k,
    ),
    keepAwake: await _preferences.getBool(_keepAwakeKey) ?? false,
    showLyrics: await _preferences.getBool(_showLyricsKey) ?? false,
    showTranslation: await _preferences.getBool(_showTranslationKey) ?? true,
  );

  @override
  Future<void> write(AppSettings settings) async {
    if (settings.origin case final origin?) {
      await _preferences.setString(_originKey, origin);
    } else {
      await _preferences.remove(_originKey);
    }
    await _preferences.setString(_themeModeKey, settings.themeMode.name);
    await _preferences.setString(_languageKey, settings.language.name);
    await _preferences.setString(_qualityKey, settings.quality.name);
    await _preferences.setBool(_keepAwakeKey, settings.keepAwake);
    await _preferences.setBool(_showLyricsKey, settings.showLyrics);
    await _preferences.setBool(_showTranslationKey, settings.showTranslation);
  }

  @override
  Future<void> clearOrigin() => _preferences.remove(_originKey);
}

T _enumValue<T extends Enum>(List<T> values, String? name, T fallback) {
  for (final value in values) {
    if (value.name == name) return value;
  }
  return fallback;
}
