import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/player/mini_player.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/player/player_controller.dart';
import 'package:musicfree_service_client/features/player/player_screen.dart';
import 'package:musicfree_service_client/features/player/player_state.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';
import 'package:musicfree_service_client/features/player/wake_lock_port.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

final class FakeResolver implements PlaybackResolver {
  @override
  Future<PlaybackSource> resolve(Track track, String quality) async =>
      PlaybackSource(
        resolved: const ResolvedTrack(
          url: '/api/v1/streams/token',
          quality: '128k',
          expiresAt: 1,
        ),
        streamUri: Uri.parse('http://service.local/api/v1/streams/token'),
      );
}

final class FakeAudio implements AudioPort {
  @override
  Stream<AudioSnapshot> get snapshots => Stream.value(
    const AudioSnapshot(
      playing: true,
      processing: PlayerProcessing.ready,
      duration: Duration(minutes: 3),
    ),
  );
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

final class SnapshotAudio implements AudioPort {
  final snapshotsController = StreamController<AudioSnapshot>.broadcast();
  Object? nextPlayError;
  int playCalls = 0;
  int resumeCalls = 0;

  void emit(AudioSnapshot snapshot) => snapshotsController.add(snapshot);

  @override
  Stream<AudioSnapshot> get snapshots => snapshotsController.stream;
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
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {
    playCalls += 1;
    final error = nextPlayError;
    nextPlayError = null;
    if (error != null) throw error;
  }

  @override
  Future<void> resume() async => resumeCalls += 1;
  @override
  Future<void> seek(Duration position) async {}

  Future<void> close() => snapshotsController.close();
}

final class FakeWakeLock implements WakeLockPort {
  final values = <bool>[];
  @override
  Future<void> setEnabled(bool value) async => values.add(value);
}

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

void main() {
  testWidgets('mini player is hidden without a queue and opens when visible', (
    tester,
  ) async {
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );
    var opened = false;
    await tester.pumpWidget(
      harness(
        MiniPlayer(
          controller: controller,
          onOpen: () => opened = true,
          variant: MiniPlayerVariant.mobile,
        ),
      ),
    );
    expect(find.byKey(const Key('mini-player')), findsNothing);

    await controller.playTracks([
      Track.fromJson({'id': 'one', 'name': 'One', 'source': 'kw'}),
    ]);
    await tester.pump();
    await tester.tap(find.byKey(const Key('mini-player')));

    expect(opened, isTrue);
  });

  testWidgets('desktop player exposes the persistent transport surface', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 160);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );
    var opened = false;
    await controller.playTracks([
      Track.fromJson({
        'id': 'desktop',
        'name': 'Desktop track',
        'source': 'kw',
      }),
    ]);

    await tester.pumpWidget(
      harness(
        MiniPlayer(
          controller: controller,
          onOpen: () => opened = true,
          variant: MiniPlayerVariant.desktop,
        ),
      ),
    );

    expect(find.byKey(const Key('desktop-persistent-player')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('desktop-persistent-player'))).height,
      96,
    );
    expect(
      tester.getSize(find.byKey(const Key('desktop-player-artwork'))),
      const Size.square(52),
    );
    expect(
      tester.getSize(find.byKey(const Key('desktop-play-pause'))),
      const Size.square(52),
    );
    for (final key in [
      'player-previous-mini',
      'player-next-mini',
      'desktop-quality',
      'desktop-lyrics',
      'desktop-queue',
    ]) {
      final size = tester.getSize(find.byKey(Key(key)));
      expect(size.width, greaterThanOrEqualTo(44), reason: key);
      expect(size.height, greaterThanOrEqualTo(44), reason: key);
    }
    await tester.tap(find.byKey(const Key('desktop-track-surface')));
    expect(opened, isTrue);
    await tester.tap(find.byKey(const Key('desktop-lyrics')));
    expect(controller.state.view, PlayerView.lyrics);
    await tester.tap(find.byKey(const Key('desktop-queue')));
    expect(controller.state.view, PlayerView.queue);
    expect(find.byKey(const Key('player-previous-mini')), findsOneWidget);
    expect(find.byKey(const Key('player-next-mini')), findsOneWidget);
    expect(find.byIcon(LucideIcons.skipBack), findsOneWidget);
    expect(find.byIcon(LucideIcons.skipForward), findsOneWidget);
  });

  testWidgets('desktop player maps loading and playback transport states', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 160);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final audio = SnapshotAudio();
    addTearDown(audio.close);
    final controller = PlayerController(resolver: FakeResolver(), audio: audio);
    await controller.playTracks([
      Track.fromJson({'id': 'states', 'name': 'States', 'source': 'kw'}),
    ]);
    await tester.pumpWidget(
      harness(
        MiniPlayer(
          controller: controller,
          onOpen: () {},
          variant: MiniPlayerVariant.desktop,
        ),
      ),
    );

    expect(find.byKey(const Key('desktop-player-loading')), findsOneWidget);
    await tester.tap(find.byKey(const Key('desktop-play-pause')));
    expect(audio.resumeCalls, 0);

    audio.emit(
      const AudioSnapshot(processing: PlayerProcessing.ready, playing: true),
    );
    await tester.pump();
    expect(find.bySemanticsLabel('暂停'), findsOneWidget);

    audio.emit(const AudioSnapshot(processing: PlayerProcessing.ready));
    await tester.pump();
    expect(find.bySemanticsLabel('播放'), findsOneWidget);

    audio.emit(const AudioSnapshot(processing: PlayerProcessing.completed));
    await tester.pump();
    expect(find.bySemanticsLabel('播放'), findsOneWidget);
  });

  testWidgets('desktop player presents an error and retries playback', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 160);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final audio = SnapshotAudio()..nextPlayError = StateError('network down');
    addTearDown(audio.close);
    final controller = PlayerController(resolver: FakeResolver(), audio: audio);
    await controller.playTracks([
      Track.fromJson({'id': 'retry', 'name': 'Retry', 'source': 'kw'}),
    ]);
    await tester.pumpWidget(
      harness(
        MiniPlayer(
          controller: controller,
          onOpen: () {},
          variant: MiniPlayerVariant.desktop,
        ),
      ),
    );

    expect(find.byKey(const Key('desktop-player-error')), findsOneWidget);
    expect(find.bySemanticsLabel('重试播放'), findsOneWidget);
    expect(audio.playCalls, 1);

    await tester.tap(find.byKey(const Key('desktop-play-pause')));
    await tester.pump();

    expect(audio.playCalls, 2);
    expect(find.byKey(const Key('desktop-player-loading')), findsOneWidget);
  });

  testWidgets('full player exposes controls and scopes keep-awake to route', (
    tester,
  ) async {
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );
    await controller.playTracks([
      Track.fromJson({'id': 'one', 'name': 'One', 'source': 'kw'}),
    ]);
    final wakeLock = FakeWakeLock();

    await tester.pumpWidget(
      harness(
        PlayerScreen(
          controller: controller,
          lyricsLoader: (_) async => const Lyrics(original: 'line'),
          wakeLock: wakeLock,
          keepAwake: true,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('One'), findsWidgets);
    expect(find.byKey(const Key('player-previous')), findsOneWidget);
    expect(find.byKey(const Key('player-play-pause')), findsOneWidget);
    expect(find.byKey(const Key('player-next')), findsOneWidget);
    expect(find.byKey(const Key('player-wide-layout')), findsOneWidget);
    expect(find.byKey(const Key('player-view-artwork')), findsNothing);
    expect(find.byKey(const Key('player-view-lyrics')), findsNothing);
    expect(find.byKey(const Key('player-view-queue')), findsNothing);
    expect(find.bySemanticsLabel('One封面'), findsWidgets);
    expect(find.text('line'), findsOneWidget);
    expect(wakeLock.values, [true]);

    await tester.pumpWidget(harness(const SizedBox()));
    await tester.pump();
    expect(wakeLock.values, [true, false]);
  });

  testWidgets('mobile player exposes artwork lyrics and queue views', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = PlayerController(
      resolver: FakeResolver(),
      audio: FakeAudio(),
    );
    await controller.playTracks([
      Track.fromJson({'id': 'one', 'name': 'One', 'source': 'kw'}),
    ]);

    await tester.pumpWidget(
      harness(
        PlayerScreen(
          controller: controller,
          lyricsLoader: (_) async => const Lyrics(original: '[00:01]Line'),
          wakeLock: FakeWakeLock(),
          keepAwake: false,
        ),
      ),
    );

    expect(find.byKey(const Key('player-mobile-layout')), findsOneWidget);
    expect(find.text('封面'), findsOneWidget);
    expect(find.text('歌词'), findsOneWidget);
    expect(find.text('队列'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
