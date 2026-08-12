import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design/app_theme.dart';
import '../features/connection/connection_controller.dart';
import '../features/connection/connection_repository.dart';
import '../features/player/service_audio_handler.dart';
import '../l10n/app_localizations.dart';
import '../storage/app_preferences.dart';
import '../storage/app_settings_controller.dart';
import 'app_providers.dart';
import 'app_router.dart';
import 'player_providers.dart';
import 'runtime_providers.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh();
  ref.listen(connectionProvider, (previous, next) => refresh.trigger());
  final invalidation = ref.read(eventInvalidationProvider);
  invalidation.addListener(refresh.trigger);
  final router = buildAppRouter(
    readConnection: () => ref.read(connectionProvider),
    readPlayer: () => ref.read(playerControllerProvider),
    readKeepAwake: () =>
        ref.read(appSettingsProvider).value?.keepAwake ?? false,
    readSettings: () => ref.read(settingsControllerProvider),
    readPlaylistVersion: () => invalidation.playlistsVersion,
    readDownloadVersion: () => invalidation.downloadsVersion,
    readPlaylistDetailVersion: invalidation.playlistDetailVersion,
    refreshListenable: refresh,
    disconnect: ref.read(connectionProvider.notifier).disconnect,
  );
  ref.onDispose(() {
    router.dispose();
    invalidation.removeListener(refresh.trigger);
    refresh.dispose();
  });
  return router;
});

final class _RouterRefresh extends ChangeNotifier {
  void trigger() => notifyListeners();
}

final class MusicFreeServiceApp extends StatelessWidget {
  MusicFreeServiceApp({
    super.key,
    ConnectionRepository? connectionRepository,
    AppPreferences? preferences,
    AudioPort? audio,
  }) : connectionRepository = connectionRepository ?? ConnectionRepository(),
       preferences = preferences ?? SharedAppPreferences(),
       audio = audio ?? SilentAudioPort();

  final ConnectionRepository connectionRepository;
  final AppPreferences preferences;
  final AudioPort audio;

  @override
  Widget build(BuildContext context) => ProviderScope(
    overrides: [
      connectionRepositoryProvider.overrideWithValue(connectionRepository),
      appPreferencesProvider.overrideWithValue(preferences),
      audioPortProvider.overrideWithValue(audio),
    ],
    child: const _AppView(),
  );
}

final class _AppView extends ConsumerWidget {
  const _AppView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(eventSubscriptionProvider);
    final AppSettings? settings = ref.watch(appSettingsProvider).value;
    final themeMode = settings?.themeMode ?? ThemeMode.system;
    final locale = switch (settings?.language ?? AppLanguage.system) {
      AppLanguage.system => null,
      AppLanguage.zh => const Locale('zh'),
      AppLanguage.en => const Locale('en'),
    };
    return ShadApp.custom(
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: themeMode,
      appBuilder: (context) => MaterialApp.router(
        onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
        debugShowCheckedModeBanner: false,
        theme: Theme.of(context),
        locale: locale,
        routerConfig: ref.watch(appRouterProvider),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalShadLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => ShadAppBuilder(child: child!),
      ),
    );
  }
}
