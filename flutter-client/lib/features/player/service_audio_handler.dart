import 'dart:async';
import 'dart:io';

import 'package:audio_service/audio_service.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

import '../../api/models.dart';
import 'player_state.dart';

String audioCacheExtension(String quality) =>
    quality.toLowerCase().contains('flac') ? '.flac' : '.mp3';

final class PlaybackStreamExpiredException implements Exception {
  const PlaybackStreamExpiredException();

  @override
  String toString() => 'Playback stream token expired.';
}

abstract interface class AudioPort {
  Stream<AudioSnapshot> get snapshots;
  void bindQueueCallbacks({
    required Future<void> Function() previous,
    required Future<void> Function() next,
  });
  Future<bool> playCachedTrack(Track track, String quality);
  Future<void> playTrack(Track track, Uri streamUri, String quality);
  Future<void> pause();
  Future<void> resume();
  Future<void> seek(Duration position);
}

final class SilentAudioPort implements AudioPort {
  @override
  Stream<AudioSnapshot> get snapshots => Stream.value(const AudioSnapshot());
  @override
  void bindQueueCallbacks({
    required Future<void> Function() previous,
    required Future<void> Function() next,
  }) {}
  @override
  Future<void> pause() async {}
  @override
  Future<bool> playCachedTrack(Track track, String quality) async => false;
  @override
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {}
  @override
  Future<void> resume() async {}
  @override
  Future<void> seek(Duration position) async {}
}

final class ServiceAudioHandler extends BaseAudioHandler
    with SeekHandler
    implements AudioPort {
  ServiceAudioHandler() {
    _subscriptions = [
      _player.playbackEventStream.listen((_) => _publishSnapshot()),
      _player.positionStream.listen(
        (position) => _publishSnapshot(position: position),
      ),
    ];
  }

  final AudioPlayer _player = AudioPlayer();
  final StreamController<AudioSnapshot> _snapshots =
      StreamController<AudioSnapshot>.broadcast();
  AudioSnapshot _last = const AudioSnapshot();
  late final List<StreamSubscription<dynamic>> _subscriptions;
  Future<void> Function() _previous = _nothing;
  Future<void> Function() _next = _nothing;

  static Future<void> _nothing() async {}

  @override
  Stream<AudioSnapshot> get snapshots async* {
    yield _last;
    yield* _snapshots.stream;
  }

  @override
  void bindQueueCallbacks({
    required Future<void> Function() previous,
    required Future<void> Function() next,
  }) {
    _previous = previous;
    _next = next;
  }

  @override
  Future<bool> playCachedTrack(Track track, String quality) async {
    final cache = await _cacheFile(track, quality);
    if (!await cache.exists()) return false;
    _setMediaItem(track);
    try {
      await _player.setFilePath(cache.path);
      await _startPlayback();
      return true;
    } on Object {
      await cache.delete();
      rethrow;
    }
  }

  @override
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {
    _setMediaItem(track);
    final cache = await _cacheFile(track, quality);
    final source = await LockCachingAudioSource(
      streamUri,
      cacheFile: cache,
    ).resolve();
    try {
      await _player.setAudioSource(source);
      await _startPlayback();
    } on PlayerException catch (error) {
      final detail = '${error.code} ${error.message}'.toLowerCase();
      if (detail.contains('401') || detail.contains('403')) {
        throw const PlaybackStreamExpiredException();
      }
      rethrow;
    }
  }

  Future<void> _startPlayback() async {
    final playback = _player.play();
    await Future.any<void>([
      _player.playingStream.firstWhere((playing) => playing),
      playback,
    ]);
    unawaited(playback.catchError((Object _) {}));
  }

  void _publishSnapshot({Duration? position}) {
    final processing = switch (_player.processingState) {
      ProcessingState.idle => PlayerProcessing.idle,
      ProcessingState.loading => PlayerProcessing.loading,
      ProcessingState.buffering => PlayerProcessing.buffering,
      ProcessingState.ready => PlayerProcessing.ready,
      ProcessingState.completed => PlayerProcessing.completed,
    };
    final currentPosition = position ?? _player.position;
    _last = AudioSnapshot(
      playing: _player.playing,
      processing: processing,
      position: currentPosition,
      duration: _player.duration ?? Duration.zero,
      buffered: _player.bufferedPosition,
    );
    _snapshots.add(_last);
    playbackState.add(
      playbackState.value.copyWith(
        controls: [
          MediaControl.skipToPrevious,
          _player.playing ? MediaControl.pause : MediaControl.play,
          MediaControl.skipToNext,
        ],
        systemActions: const {MediaAction.seek},
        playing: _player.playing,
        processingState: switch (_player.processingState) {
          ProcessingState.idle => AudioProcessingState.idle,
          ProcessingState.loading => AudioProcessingState.loading,
          ProcessingState.buffering => AudioProcessingState.buffering,
          ProcessingState.ready => AudioProcessingState.ready,
          ProcessingState.completed => AudioProcessingState.completed,
        },
        updatePosition: currentPosition,
        bufferedPosition: _player.bufferedPosition,
      ),
    );
  }

  void _setMediaItem(Track track) {
    mediaItem.add(
      MediaItem(
        id: track.id,
        title: track.title.isEmpty ? track.id : track.title,
        artist: track.artist,
      ),
    );
  }

  Future<File> _cacheFile(Track track, String quality) async {
    final root = await getApplicationSupportDirectory();
    final directory = Directory(
      '${root.path}${Platform.pathSeparator}media-cache',
    );
    await directory.create(recursive: true);
    final key = '${track.source}-${track.id}-$quality'.replaceAll(
      RegExp(r'[^a-zA-Z0-9._-]'),
      '_',
    );
    return File(
      '${directory.path}${Platform.pathSeparator}$key'
      '${audioCacheExtension(quality)}',
    );
  }

  @override
  Future<void> play() => _player.play();
  @override
  Future<void> resume() => _player.play();
  @override
  Future<void> pause() => _player.pause();
  @override
  Future<void> seek(Duration position) => _player.seek(position);
  @override
  Future<void> skipToPrevious() => _previous();
  @override
  Future<void> skipToNext() => _next();

  @override
  Future<void> stop() async {
    await _player.stop();
    await Future.wait(
      _subscriptions.map((subscription) => subscription.cancel()),
    );
    await _snapshots.close();
    await _player.dispose();
    return super.stop();
  }
}
