import 'package:flutter/foundation.dart';

import 'source_repository.dart';

final class SourcesState {
  const SourcesState({
    this.items = const [],
    this.loading = false,
    this.switchingId,
    this.error,
  });

  final List<InstalledMusicSource> items;
  final bool loading;
  final String? switchingId;
  final Object? error;

  InstalledMusicSource? get active =>
      items.where((item) => item.active).firstOrNull;

  SourcesState copyWith({
    List<InstalledMusicSource>? items,
    bool? loading,
    String? switchingId,
    bool clearSwitching = false,
    Object? error,
    bool clearError = false,
  }) => SourcesState(
    items: items ?? this.items,
    loading: loading ?? this.loading,
    switchingId: clearSwitching ? null : switchingId ?? this.switchingId,
    error: clearError ? null : error ?? this.error,
  );
}

final class SourcesController extends ChangeNotifier {
  SourcesController(this.repository);
  final SourceRepository repository;

  SourcesState state = const SourcesState();

  Future<void> refresh() async {
    state = state.copyWith(loading: true, clearError: true);
    notifyListeners();
    try {
      state = state.copyWith(items: await repository.list(), loading: false);
    } on Object catch (error) {
      state = state.copyWith(loading: false, error: error);
    }
    notifyListeners();
  }

  Future<void> activate(String id) async {
    if (state.switchingId != null || state.active?.id == id) return;
    state = state.copyWith(switchingId: id, clearError: true);
    notifyListeners();
    try {
      final active = await repository.activate(id);
      state = state.copyWith(
        items: [
          for (final item in state.items)
            InstalledMusicSource(
              id: item.id,
              name: item.name,
              description: item.description,
              version: item.version,
              author: item.author,
              homepage: item.homepage,
              active: item.id == active.id,
              providers: item.id == active.id
                  ? active.providers
                  : item.providers,
            ),
        ],
        clearSwitching: true,
      );
    } on Object catch (error) {
      // Keep the previous active item until the Service confirms the switch.
      state = state.copyWith(error: error, clearSwitching: true);
    }
    notifyListeners();
  }
}
