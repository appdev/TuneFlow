import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import 'playlist_repository.dart';

final class PlaylistsState {
  const PlaylistsState({
    this.items = const [],
    this.loading = false,
    this.stale = false,
    this.error,
  });

  final List<PlaylistDetail> items;
  final bool loading;
  final bool stale;
  final Object? error;
}

final class PlaylistsController extends ChangeNotifier {
  PlaylistsController(this.repository, {String Function()? idFactory})
    : _idFactory =
          idFactory ??
          (() => 'flutter_${DateTime.now().microsecondsSinceEpoch}');

  final PlaylistRepository repository;
  final String Function() _idFactory;
  PlaylistsState state = const PlaylistsState();

  Future<void> refresh() async {
    state = PlaylistsState(
      items: state.items,
      loading: true,
      stale: state.stale,
      error: state.error,
    );
    notifyListeners();
    try {
      final items = await repository.listDetails();
      state = PlaylistsState(items: items);
    } on Object catch (error) {
      state = PlaylistsState(items: state.items, stale: true, error: error);
    }
    notifyListeners();
  }

  Future<void> create({required String name}) async {
    await repository.create(id: _idFactory(), name: name);
    await refresh();
  }

  Future<void> delete(String id) async {
    await repository.delete(id);
    await refresh();
  }

  void invalidate() {
    state = PlaylistsState(items: state.items, stale: true, error: state.error);
    notifyListeners();
  }
}
