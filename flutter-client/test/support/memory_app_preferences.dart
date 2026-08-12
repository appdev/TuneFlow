import 'package:musicfree_service_client/storage/app_preferences.dart';

final class MemoryAppPreferences implements AppPreferences {
  MemoryAppPreferences([this.settings = const AppSettings()]);

  AppSettings settings;

  @override
  Future<void> clearOrigin() async {
    settings = settings.copyWith(clearOrigin: true);
  }

  @override
  Future<AppSettings> read() async => settings;

  @override
  Future<void> write(AppSettings value) async => settings = value;
}
