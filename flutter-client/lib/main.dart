import 'package:audio_service/audio_service.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'app/app.dart';
import 'features/player/service_audio_handler.dart';
import 'platform/app_platform.dart';
import 'platform/desktop_window_bootstrap.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final appPlatform = resolveAppPlatform(defaultTargetPlatform);
  await initializeDesktopWindow(appPlatform);
  final languageCode = PlatformDispatcher.instance.locale.languageCode;
  final playbackChannelName = languageCode == 'zh'
      ? '音流播放'
      : 'TuneFlow Playback';
  final audio = await AudioService.init<ServiceAudioHandler>(
    builder: ServiceAudioHandler.new,
    config: AudioServiceConfig(
      androidNotificationChannelId: 'com.musicfree.serviceclient.playback',
      androidNotificationChannelName: playbackChannelName,
      androidNotificationOngoing: true,
    ),
  );
  runApp(MusicFreeServiceApp(audio: audio));
}
