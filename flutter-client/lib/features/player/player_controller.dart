import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import 'playback_repository.dart';
import 'player_state.dart';
import 'service_audio_handler.dart';

final class PlayerController extends ChangeNotifier {
  PlayerController({
    required this.resolver,
    required this.audio,
    String quality = '128k',
    bool showTranslation = true,
    Future<void> Function(Track track)? recordHistory,
  }) : state = PlayerState(quality: quality, showTranslation: showTranslation) {
    _recordHistory = recordHistory;
    audio.bindQueueCallbacks(previous: previous, next: next);
    _subscription = audio.snapshots.listen(_onSnapshot);
  }

  final PlaybackResolver resolver;
  final AudioPort audio;
  late final Future<void> Function(Track track)? _recordHistory;
  late final StreamSubscription<AudioSnapshot> _subscription;
  PlayerState state;

  Future<void> playTracks(List<Track> tracks, {int startIndex = 0}) async {
    if (tracks.isEmpty) return;
    if (startIndex < 0 || startIndex >= tracks.length) {
      throw RangeError.index(startIndex, tracks, 'startIndex');
    }
    state = PlayerState(
      queue: List.unmodifiable(tracks),
      currentIndex: startIndex,
      quality: state.quality,
      processing: PlayerProcessing.loading,
      showLyrics: state.showLyrics,
      showTranslation: state.showTranslation,
      view: state.view,
    );
    notifyListeners();
    await _playCurrent();
  }

  void enqueue(Track track) {
    state = state.copyWith(queue: List.unmodifiable([...state.queue, track]));
    notifyListeners();
  }

  Future<void> playNext(Track track) async {
    final current = state.current;
    if (current == null) {
      await play(track);
      return;
    }
    if (current.source == track.source && current.id == track.id) return;
    final queue = state.queue
        .where((item) => item.source != track.source || item.id != track.id)
        .toList();
    final currentIndex = queue.indexWhere(
      (item) => item.source == current.source && item.id == current.id,
    );
    queue.insert(currentIndex + 1, track);
    state = state.copyWith(
      queue: List.unmodifiable(queue),
      currentIndex: currentIndex,
    );
    notifyListeners();
  }

  Future<void> play(Track track) => playTracks([track]);

  Future<void> playIndex(int index) async {
    if (index < 0 || index >= state.queue.length) return;
    state = state.copyWith(
      currentIndex: index,
      processing: PlayerProcessing.loading,
      error: null,
    );
    notifyListeners();
    await _playCurrent();
  }

  Future<void> previous() => playIndex(state.currentIndex - 1);
  Future<void> next() => playIndex(state.currentIndex + 1);
  Future<void> pause() => audio.pause();
  Future<void> resume() async {
    if (state.current == null) {
      await audio.resume();
      return;
    }
    if (state.processing == PlayerProcessing.error || state.error != null) {
      state = state.copyWith(processing: PlayerProcessing.loading, error: null);
      notifyListeners();
      await _playCurrent();
      return;
    }
    if (state.processing == PlayerProcessing.completed) {
      await audio.seek(Duration.zero);
    }
    await audio.resume();
  }

  Future<void> seek(Duration position) => audio.seek(position);

  Future<void> setQuality(String quality) async {
    if (quality == state.quality) return;
    state = state.copyWith(quality: quality);
    notifyListeners();
    if (state.current != null) await _playCurrent();
  }

  void setShowLyrics(bool value) {
    state = state.copyWith(
      showLyrics: value,
      view: value ? PlayerView.lyrics : PlayerView.artwork,
    );
    notifyListeners();
  }

  void setView(PlayerView view) {
    state = state.copyWith(view: view, showLyrics: view == PlayerView.lyrics);
    notifyListeners();
  }

  void setShowTranslation(bool value) {
    state = state.copyWith(showTranslation: value);
    notifyListeners();
  }

  Future<void> loadLyrics(Future<Lyrics> Function(Track track) loader) async {
    final track = state.current;
    if (track == null) return;
    try {
      final lyrics = await loader(track);
      state = state.copyWith(lyrics: lyrics, error: null);
    } on Object catch (error) {
      state = state.copyWith(error: error);
    }
    notifyListeners();
  }

  Future<void> _playCurrent() async {
    final track = state.current;
    if (track == null) return;
    try {
      if (await audio.playCachedTrack(track, state.quality)) {
        state = state.copyWith(error: null);
        notifyListeners();
        _saveHistory(track);
        return;
      }
    } on Object {
      // A stale or undecodable cache must not prevent a fresh Service resolve.
    }
    Object? lastError;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final source = await resolver.resolve(track, state.quality);
        await audio.playTrack(track, source.streamUri, state.quality);
        state = state.copyWith(error: null);
        notifyListeners();
        _saveHistory(track);
        return;
      } on PlaybackStreamExpiredException catch (error) {
        lastError = error;
        if (attempt == 0) continue;
      } on Object catch (error) {
        lastError = error;
        break;
      }
    }
    state = state.copyWith(
      processing: PlayerProcessing.error,
      error: lastError,
    );
    notifyListeners();
  }

  void _saveHistory(Track track) {
    final save = _recordHistory;
    if (save != null) unawaited(save(track).catchError((_) {}));
  }

  void _onSnapshot(AudioSnapshot snapshot) {
    state = state.copyWith(
      playing: snapshot.playing,
      processing: snapshot.processing,
      position: snapshot.position,
      duration: snapshot.duration,
      buffered: snapshot.buffered,
    );
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
