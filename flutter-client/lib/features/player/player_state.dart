import '../../api/models.dart';

enum PlayerProcessing { idle, loading, buffering, ready, completed, error }

enum PlayerView { artwork, lyrics, queue }

final class AudioSnapshot {
  const AudioSnapshot({
    this.playing = false,
    this.processing = PlayerProcessing.idle,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.buffered = Duration.zero,
  });

  final bool playing;
  final PlayerProcessing processing;
  final Duration position;
  final Duration duration;
  final Duration buffered;
}

final class PlayerState {
  const PlayerState({
    this.queue = const [],
    this.currentIndex = -1,
    this.quality = '128k',
    this.playing = false,
    this.processing = PlayerProcessing.idle,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.buffered = Duration.zero,
    this.lyrics,
    this.showLyrics = false,
    this.showTranslation = true,
    this.view = PlayerView.artwork,
    this.error,
  });

  final List<Track> queue;
  final int currentIndex;
  final String quality;
  final bool playing;
  final PlayerProcessing processing;
  final Duration position;
  final Duration duration;
  final Duration buffered;
  final Lyrics? lyrics;
  final bool showLyrics;
  final bool showTranslation;
  final PlayerView view;
  final Object? error;

  Track? get current => currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;

  PlayerState copyWith({
    List<Track>? queue,
    int? currentIndex,
    String? quality,
    bool? playing,
    PlayerProcessing? processing,
    Duration? position,
    Duration? duration,
    Duration? buffered,
    Lyrics? lyrics,
    bool? showLyrics,
    bool? showTranslation,
    PlayerView? view,
    Object? error = _unchanged,
  }) => PlayerState(
    queue: queue ?? this.queue,
    currentIndex: currentIndex ?? this.currentIndex,
    quality: quality ?? this.quality,
    playing: playing ?? this.playing,
    processing: processing ?? this.processing,
    position: position ?? this.position,
    duration: duration ?? this.duration,
    buffered: buffered ?? this.buffered,
    lyrics: lyrics ?? this.lyrics,
    showLyrics: showLyrics ?? this.showLyrics,
    showTranslation: showTranslation ?? this.showTranslation,
    view: view ?? this.view,
    error: identical(error, _unchanged) ? this.error : error,
  );
}

const _unchanged = Object();
