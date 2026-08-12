import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import '../../design/components/track_actions.dart';
import 'playlist_repository.dart';

final class PlaylistDetailState {
  const PlaylistDetailState({
    this.detail,
    this.loading = false,
    this.stale = false,
    this.error,
  });

  final PlaylistDetail? detail;
  final bool loading;
  final bool stale;
  final Object? error;
}

final class PlaylistDetailController extends ChangeNotifier {
  PlaylistDetailController(this.repository, this.playlistId);

  final PlaylistRepository repository;
  final String playlistId;
  PlaylistDetailState state = const PlaylistDetailState();

  Future<void> refresh() async {
    state = PlaylistDetailState(
      detail: state.detail,
      loading: true,
      stale: state.stale,
      error: state.error,
    );
    notifyListeners();
    try {
      final detail = await repository.get(playlistId);
      state = PlaylistDetailState(detail: detail);
    } on Object catch (error) {
      state = PlaylistDetailState(
        detail: state.detail,
        stale: true,
        error: error,
      );
    }
    notifyListeners();
  }

  Future<void> remove(String trackId) async {
    await repository.removeTracks(playlistId, [trackId]);
    await refresh();
  }

  Future<void> rename(String name) async {
    final normalized = name.trim();
    if (normalized.isEmpty) return;
    await repository.update(playlistId, normalized);
    await refresh();
  }

  Future<void> delete() => repository.delete(playlistId);

  Future<void> reorder({
    required int position,
    required List<String> trackIds,
  }) async {
    await repository.reorderTracks(playlistId, position, trackIds);
    await refresh();
  }

  Future<void> playOne(PlayTracks play, int index) async {
    final detail = state.detail;
    if (detail == null || index < 0 || index >= detail.tracks.length) return;
    await play([detail.tracks[index]]);
  }

  Future<void> playAll(PlayTracks play) async {
    final tracks = state.detail?.tracks ?? const <Track>[];
    if (tracks.isNotEmpty) await play(tracks);
  }

  void invalidate() {
    state = PlaylistDetailState(
      detail: state.detail,
      stale: true,
      error: state.error,
    );
    notifyListeners();
  }
}
