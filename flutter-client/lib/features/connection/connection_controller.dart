import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/app_providers.dart';
import 'connection_repository.dart';

final connectionProvider =
    AsyncNotifierProvider<ConnectionController, ConnectedService?>(
      ConnectionController.new,
    );

final class ConnectionController extends AsyncNotifier<ConnectedService?> {
  @override
  Future<ConnectedService?> build() async {
    final settings = await ref.read(appPreferencesProvider).read();
    final origin = settings.origin;
    if (origin == null) return null;
    return ref.read(connectionRepositoryProvider).connect(origin);
  }

  Future<void> connect(String origin) async {
    state = const AsyncLoading();
    final next = await AsyncValue.guard(
      () => ref.read(connectionRepositoryProvider).connect(origin),
    );
    if (next case AsyncData(value: final connected)) {
      final preferences = ref.read(appPreferencesProvider);
      final settings = await preferences.read();
      await preferences.write(
        settings.copyWith(origin: connected.origin.uri.toString()),
      );
    }
    state = next;
  }

  Future<void> disconnect() async {
    state.value?.api.close();
    await ref.read(appPreferencesProvider).clearOrigin();
    state = const AsyncData(null);
  }
}
