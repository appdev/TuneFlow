import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/client_data/client_data_repository.dart';
import '../features/connection/connection_controller.dart';
import '../features/player/playback_repository.dart';
import '../features/player/player_controller.dart';
import '../storage/app_settings_controller.dart';
import 'app_providers.dart';

final playerControllerProvider = Provider<PlayerController?>((ref) {
  final connected = ref.watch(connectionProvider).value;
  if (connected == null) return null;
  final quality =
      ref.read(appSettingsProvider).value?.quality.apiValue ?? '128k';
  final showTranslation =
      ref.read(appSettingsProvider).value?.showTranslation ?? true;
  final controller = PlayerController(
    resolver: PlaybackRepository(connected.api),
    audio: ref.read(audioPortProvider),
    quality: quality,
    showTranslation: showTranslation,
    recordHistory: ClientDataRepository(connected.api).recordPlayback,
  );
  ref.onDispose(controller.dispose);
  return controller;
});
