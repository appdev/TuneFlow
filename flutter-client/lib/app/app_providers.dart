import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/connection/connection_repository.dart';
import '../features/player/service_audio_handler.dart';
import '../storage/app_preferences.dart';

final appPreferencesProvider = Provider<AppPreferences>(
  (ref) => SharedAppPreferences(),
);

final connectionRepositoryProvider = Provider<ConnectionRepository>(
  (ref) => ConnectionRepository(),
);

final audioPortProvider = Provider<AudioPort>((ref) => SilentAudioPort());
