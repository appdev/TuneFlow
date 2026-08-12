import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import '../downloads/download_repository.dart';
import '../client_data/client_data_repository.dart';
import '../library/library_repository.dart';
import '../playlists/playlist_repository.dart';

final class HomeState {
  const HomeState({
    this.playlists = const [],
    this.downloads = const [],
    this.loading = false,
    this.stale = false,
    this.error,
    this.library = const [],
    this.continueListening = const [],
    this.lastSyncedAt,
  });

  final List<PlaylistSummary> playlists;
  final List<DownloadJob> downloads;
  final bool loading;
  final bool stale;
  final Object? error;
  final List<LibraryTrack> library;
  final List<Track> continueListening;
  final DateTime? lastSyncedAt;
  List<Track> get recentlyArrived {
    final completed =
        downloads
            .where((job) => job.status == DownloadStatus.completed)
            .toList(growable: false)
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return completed.map((job) => job.musicInfo).toList(growable: false);
  }

  List<Track> get featured {
    final seen = <String>{};
    final tracks = <Track>[];
    for (final track in [
      ...continueListening,
      ...recentlyArrived,
      ...library.map((item) => item.track),
    ]) {
      if (seen.add('${track.source}:${track.id}')) tracks.add(track);
      if (tracks.length == 6) break;
    }
    return tracks;
  }

  num get libraryBytes =>
      library.fold<num>(0, (total, track) => total + track.size);
}

final class HomeController extends ChangeNotifier {
  HomeController({
    required this.playlists,
    required this.downloads,
    required this.library,
    this.history,
  });

  final PlaylistRepository playlists;
  final DownloadRepository downloads;
  final LibraryRepository library;
  final ClientDataRepository? history;
  HomeState state = const HomeState();

  Future<void> refresh() async {
    state = HomeState(
      playlists: state.playlists,
      downloads: state.downloads,
      loading: true,
      stale: state.stale,
      error: state.error,
      library: state.library,
      continueListening: state.continueListening,
      lastSyncedAt: state.lastSyncedAt,
    );
    notifyListeners();

    List<PlaylistSummary>? nextPlaylists;
    List<DownloadJob>? nextDownloads;
    List<LibraryTrack>? nextLibrary;
    List<PlaybackHistoryEntry>? nextHistory;
    Object? firstError;
    Future<void> loadPlaylists() async {
      try {
        nextPlaylists = await playlists.list();
      } on Object catch (error) {
        firstError ??= error;
      }
    }

    Future<void> loadDownloads() async {
      try {
        nextDownloads = await downloads.list();
      } on Object catch (error) {
        firstError ??= error;
      }
    }

    Future<void> loadLibrary() async {
      try {
        nextLibrary = await library.list();
      } on Object catch (error) {
        firstError ??= error;
      }
    }

    Future<void> loadHistory() async {
      final repository = history;
      if (repository == null) return;
      try {
        nextHistory = await repository.readPlaybackHistory();
      } on Object catch (error) {
        firstError ??= error;
      }
    }

    await Future.wait([
      loadPlaylists(),
      loadDownloads(),
      loadLibrary(),
      loadHistory(),
    ]);

    state = HomeState(
      playlists: nextPlaylists ?? state.playlists,
      downloads: nextDownloads ?? state.downloads,
      library: nextLibrary ?? state.library,
      continueListening:
          nextHistory?.map((item) => item.track).toList(growable: false) ??
          state.continueListening,
      lastSyncedAt: firstError == null ? DateTime.now() : state.lastSyncedAt,
      stale: firstError != null,
      error: firstError,
    );
    notifyListeners();
  }
}
