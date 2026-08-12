import 'package:flutter/material.dart';

import '../../api/service_origin.dart';
import '../../storage/app_preferences.dart';
import '../connection/connection_repository.dart';

typedef SaveSettings = Future<void> Function(AppSettings settings);

final class SettingsController extends ChangeNotifier {
  SettingsController({
    required AppSettings settings,
    required SaveSettings save,
    required Future<void> Function(String origin) connect,
    required Future<void> Function() disconnect,
    required Future<void> Function(String quality) setPlayerQuality,
    Future<ConnectionDiagnostics> Function(String origin)? diagnostics,
  }) : state = settings,
       _save = save,
       _connect = connect,
       _disconnect = disconnect,
       _setPlayerQuality = setPlayerQuality,
       _diagnostics = diagnostics;

  final SaveSettings _save;
  final Future<void> Function(String origin) _connect;
  final Future<void> Function() _disconnect;
  final Future<void> Function(String quality) _setPlayerQuality;
  final Future<ConnectionDiagnostics> Function(String origin)? _diagnostics;
  AppSettings state;
  ConnectionDiagnostics? connection;
  bool diagnosticsLoading = false;
  Object? diagnosticsError;

  Future<void> _persist(AppSettings next) async {
    await _save(next);
    state = next;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode value) =>
      _persist(state.copyWith(themeMode: value));
  Future<void> setLanguage(AppLanguage value) =>
      _persist(state.copyWith(language: value));

  Future<void> setQuality(PlaybackQuality value) async {
    await _setPlayerQuality(value.apiValue);
    await _persist(state.copyWith(quality: value));
  }

  Future<void> setKeepAwake(bool value) =>
      _persist(state.copyWith(keepAwake: value));
  Future<void> setShowLyrics(bool value) =>
      _persist(state.copyWith(showLyrics: value));
  Future<void> setShowTranslation(bool value) =>
      _persist(state.copyWith(showTranslation: value));

  Future<void> replaceOrigin(String rawOrigin) async {
    final origin = ServiceOrigin.parse(rawOrigin).uri.toString();
    await _connect(origin);
    state = state.copyWith(origin: origin);
    notifyListeners();
    await refreshDiagnostics();
  }

  Future<void> refreshDiagnostics() async {
    final origin = state.origin;
    final probe = _diagnostics;
    if (origin == null || probe == null) return;
    diagnosticsLoading = true;
    diagnosticsError = null;
    notifyListeners();
    try {
      connection = await probe(origin);
    } on Object catch (error) {
      diagnosticsError = error;
    } finally {
      diagnosticsLoading = false;
      notifyListeners();
    }
  }

  Future<void> disconnect() => _disconnect();
}
