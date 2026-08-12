import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/player/player_controller.dart';
import 'package:musicfree_service_client/features/search/track_action.dart';

import '../player/player_controller_test.dart' show FakeAudio, FakeResolver;

void main() {
  test(
    'builds the approved action order and forwards highest quality',
    () async {
      final track = Track.fromJson({
        'id': 'one',
        'name': 'One',
        'source': 'kw',
        'types': ['128k', 'flac'],
      });
      final player = PlayerController(
        resolver: FakeResolver(),
        audio: FakeAudio(),
      );
      String? quality;
      final actions = buildTrackActions(
        track: track,
        player: player,
        showLyrics: (_) async {},
        addToPlaylist: (_) async {},
        download: (_, value) async => quality = value,
      );

      expect(actions.map((action) => action.id), TrackActionId.values);
      await actions.last.invoke();
      expect(quality, 'flac');
    },
  );
}
