import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/features/player/player_state.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';

void main() {
  test('cache files use a codec extension macOS can decode', () {
    expect(audioCacheExtension('128k'), '.mp3');
    expect(audioCacheExtension('320k'), '.mp3');
    expect(audioCacheExtension('flac'), '.flac');
    expect(audioCacheExtension('flac24bit'), '.flac');
  });

  test('silent audio port exposes a stable idle snapshot contract', () async {
    final audio = SilentAudioPort();
    final snapshot = await audio.snapshots.first;

    expect(snapshot.processing, PlayerProcessing.idle);
    expect(snapshot.playing, isFalse);
  });
}
