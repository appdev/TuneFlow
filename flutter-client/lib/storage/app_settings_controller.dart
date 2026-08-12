import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/app_providers.dart';
import 'app_preferences.dart';

final appSettingsProvider =
    AsyncNotifierProvider<AppSettingsController, AppSettings>(
      AppSettingsController.new,
    );

final class AppSettingsController extends AsyncNotifier<AppSettings> {
  @override
  Future<AppSettings> build() => ref.read(appPreferencesProvider).read();

  Future<void> saveSettings(AppSettings settings) async {
    await ref.read(appPreferencesProvider).write(settings);
    state = AsyncData(settings);
  }
}
