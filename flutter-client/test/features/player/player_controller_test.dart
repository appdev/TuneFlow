import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/player/player_controller.dart';
import 'package:musicfree_service_client/features/player/player_state.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';

final class FakeResolver implements PlaybackResolver {
  int calls = 0;
  final List<String> qualities = [];

  @override
  Future<PlaybackSource> resolve(Track track, String quality) async {
    calls++;
    qualities.add(quality);
    return PlaybackSource(
      resolved: const ResolvedTrack(
        url: '/api/v1/streams/token',
        quality: '128k',
        expiresAt: 1000,
      ),
      streamUri: Uri.parse('http://service.local/api/v1/streams/token-$calls'),
    );
  }
}

class FakeAudio implements AudioPort {
  final controller = StreamController<AudioSnapshot>.broadcast();
  int playCalls = 0;
  int pauseCalls = 0;
  int resumeCalls = 0;
  final List<Duration> seekCalls = [];
  Object? playError;
  bool cached = false;
  Future<void> Function()? previousCallback;
  Future<void> Function()? nextCallback;

  @override
  Stream<AudioSnapshot> get snapshots => controller.stream;

  @override
  void bindQueueCallbacks({
    required Future<void> Function() previous,
    required Future<void> Function() next,
  }) {
    previousCallback = previous;
    nextCallback = next;
  }

  @override
  Future<bool> playCachedTrack(Track track, String quality) async => cached;

  @override
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {
    playCalls++;
    if (playError case final error?) throw error;
  }

  @override
  Future<void> pause() async => pauseCalls++;
  @override
  Future<void> resume() async => resumeCalls++;
  @override
  Future<void> seek(Duration position) async => seekCalls.add(position);
}

Track track(String id) =>
    Track.fromJson({'id': id, 'name': id, 'source': 'kw'});

void main() {
  test(
    'play next inserts after current and replaces queued duplicate',
    () async {
      final controller = PlayerController(
        resolver: FakeResolver(),
        audio: FakeAudio(),
      );
      await controller.playTracks([track('a'), track('c'), track('b')]);

      await controller.playNext(track('b'));

      expect(controller.state.queue.map((item) => item.id), ['a', 'b', 'c']);
      expect(controller.state.current?.id, 'a');
    },
  );

  test('play next starts playback when the queue is empty', () async {
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );

    await controller.playNext(track('a'));

    expect(controller.state.current?.id, 'a');
  });

  test(
    'queue replacement, navigation, and quality reach the resolver',
    () async {
      final resolver = FakeResolver();
      final audio = FakeAudio();
      final controller = PlayerController(resolver: resolver, audio: audio);

      await controller.playTracks([track('a'), track('b')], startIndex: 1);
      expect(controller.state.current?.id, 'b');
      await controller.previous();
      expect(controller.state.current?.id, 'a');
      await controller.next();
      expect(controller.state.current?.id, 'b');
      await controller.next();
      expect(controller.state.current?.id, 'b');
      controller.enqueue(track('c'));
      await controller.setQuality('320k');

      expect(controller.state.queue.map((item) => item.id), ['a', 'b', 'c']);
      expect(resolver.qualities.last, '320k');
      expect(audio.previousCallback, isNotNull);
      expect(audio.nextCallback, isNotNull);
    },
  );

  test(
    'audio snapshots update transport state and controls delegate',
    () async {
      final audio = FakeAudio();
      final controller = PlayerController(
        resolver: FakeResolver(),
        audio: audio,
      );
      audio.controller.add(
        const AudioSnapshot(
          playing: true,
          processing: PlayerProcessing.ready,
          position: Duration(seconds: 4),
          duration: Duration(seconds: 10),
          buffered: Duration(seconds: 7),
        ),
      );
      await Future<void>.delayed(Duration.zero);
      await controller.pause();
      await controller.resume();

      expect(controller.state.playing, isTrue);
      expect(controller.state.position, const Duration(seconds: 4));
      expect(audio.pauseCalls, 1);
      expect(audio.resumeCalls, 1);
    },
  );

  test(
    'expired playback token resolves exactly once more then exposes error',
    () async {
      final resolver = FakeResolver();
      final audio = FakeAudio()
        ..playError = const PlaybackStreamExpiredException();
      final controller = PlayerController(resolver: resolver, audio: audio);

      await controller.playTracks([track('a')]);

      expect(resolver.calls, 2);
      expect(audio.playCalls, 2);
      expect(controller.state.error, isA<PlaybackStreamExpiredException>());
    },
  );

  test('successful expiry retry clears the first error', () async {
    final resolver = FakeResolver();
    final audio = _ExpireOnceAudio();
    final controller = PlayerController(resolver: resolver, audio: audio);

    await controller.playTracks([track('a')]);

    expect(resolver.calls, 2);
    expect(controller.state.error, isNull);
  });

  test(
    'resume retries a failed track instead of delegating a stale resume',
    () async {
      final resolver = FakeResolver();
      final audio = FakeAudio()..playError = StateError('network');
      final controller = PlayerController(resolver: resolver, audio: audio);

      await controller.play(track('a'));
      expect(controller.state.processing, PlayerProcessing.error);

      audio.playError = null;
      await controller.resume();

      expect(audio.playCalls, 2);
      expect(audio.resumeCalls, 0);
      expect(controller.state.error, isNull);
    },
  );

  test('resume restarts a completed track from the beginning', () async {
    final audio = FakeAudio();
    final controller = PlayerController(resolver: FakeResolver(), audio: audio);
    await controller.play(track('a'));
    audio.controller.add(
      const AudioSnapshot(
        playing: false,
        processing: PlayerProcessing.completed,
        position: Duration(seconds: 30),
        duration: Duration(seconds: 30),
        buffered: Duration(seconds: 30),
      ),
    );
    await Future<void>.delayed(Duration.zero);

    await controller.resume();

    expect(audio.seekCalls, [Duration.zero]);
    expect(audio.resumeCalls, 1);
  });

  test(
    'cached playback remains available without resolving the Service',
    () async {
      final resolver = FakeResolver();
      final audio = FakeAudio()..cached = true;
      final controller = PlayerController(resolver: resolver, audio: audio);

      await controller.playTracks([track('offline')]);

      expect(resolver.calls, 0);
      expect(controller.state.error, isNull);
    },
  );

  test(
    'invalid cached playback falls back to a fresh Service stream',
    () async {
      final resolver = FakeResolver();
      final audio = _InvalidCacheAudio();
      final controller = PlayerController(resolver: resolver, audio: audio);

      await controller.playTracks([track('stale-cache')]);

      expect(resolver.calls, 1);
      expect(audio.playCalls, 1);
      expect(controller.state.error, isNull);
    },
  );

  test('mobile player tabs and swipe share one selected view state', () {
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );

    controller.setView(PlayerView.queue);

    expect(controller.state.view, PlayerView.queue);
  });
}

final class _ExpireOnceAudio extends FakeAudio {
  @override
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {
    playCalls++;
    if (playCalls == 1) throw const PlaybackStreamExpiredException();
  }
}

final class _InvalidCacheAudio extends FakeAudio {
  @override
  Future<bool> playCachedTrack(Track track, String quality) async {
    throw StateError('invalid cache');
  }
}
