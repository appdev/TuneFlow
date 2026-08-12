import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:musicfree_service_client/app/app.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('macOS preferences complete native reads', (tester) async {
    await expectLater(
      SharedAppPreferences().read().timeout(const Duration(seconds: 3)),
      completes,
    );
  });

  testWidgets('macOS app leaves loading with native preferences', (
    tester,
  ) async {
    await tester.pumpWidget(MusicFreeServiceApp());
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('connection-route')).evaluate().isNotEmpty ||
          find.byKey(const Key('home-route')).evaluate().isNotEmpty,
      isTrue,
    );
  });

  testWidgets('macOS app leaves loading after audio service initialization', (
    tester,
  ) async {
    final audio = await AudioService.init<ServiceAudioHandler>(
      builder: ServiceAudioHandler.new,
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'com.musicfree.serviceclient.playback',
        androidNotificationChannelName: 'MusicFree 播放',
      ),
    );
    await tester.pumpWidget(MusicFreeServiceApp(audio: audio));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('connection-route')).evaluate().isNotEmpty ||
          find.byKey(const Key('home-route')).evaluate().isNotEmpty,
      isTrue,
    );
  });
}
