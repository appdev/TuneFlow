import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/library/library_repository.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';
import 'package:musicfree_service_client/features/search/search_repository.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final origin = Platform.environment['LX_SERVICE_ORIGIN'];
  testWidgets(
    'real macOS audio snapshots advance for standard and lossless playback',
    (_) async {
      final connected = await ConnectionRepository().connect(origin!);
      final search = SearchRepository(connected.api);
      final page = await _searchWithRetry(search);
      final track = page.tracks.first;
      try {
        for (final quality in ['128k', 'flac']) {
          final source = await PlaybackRepository(
            connected.api,
          ).resolve(track, quality);
          final audio = ServiceAudioHandler();
          try {
            try {
              await audio
                  .playTrack(track, source.streamUri, quality)
                  .timeout(const Duration(seconds: 4));
            } on Object catch (error) {
              fail(
                '$quality load failed '
                '(resolved ${source.resolved.quality}): $error',
              );
            }
            final advanced = await audio.snapshots
                .firstWhere(
                  (snapshot) => snapshot.position >= const Duration(seconds: 1),
                )
                .timeout(const Duration(seconds: 10));
            expect(advanced.playing, isTrue, reason: quality);
            expect(advanced.duration, greaterThan(Duration.zero));
          } finally {
            await audio.pause();
            await audio.stop();
          }
        }

        final library = await LibraryRepository(connected.api).list();
        final local = library.firstWhere(
          (item) => item.size > 1024 * 1024 && item.extension == 'flac',
        );
        final source = await PlaybackRepository(
          connected.api,
        ).resolve(local.track, 'flac');
        final audio = ServiceAudioHandler();
        try {
          await audio
              .playTrack(local.track, source.streamUri, 'flac')
              .timeout(const Duration(seconds: 4));
          final advanced = await audio.snapshots
              .firstWhere(
                (snapshot) => snapshot.position >= const Duration(seconds: 1),
              )
              .timeout(const Duration(seconds: 10));
          expect(advanced.playing, isTrue, reason: 'local flac');
          expect(advanced.duration, greaterThan(Duration.zero));
        } finally {
          await audio.pause();
          await audio.stop();
        }
      } finally {
        connected.api.close();
      }
    },
    skip: origin == null,
  );
}

Future<SearchPage> _searchWithRetry(SearchRepository repository) async {
  Object? lastError;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      return await repository.search(
        source: 'tx',
        text: '七里香 周杰伦',
        page: 1,
        pageSize: 5,
      );
    } on Object catch (error) {
      lastError = error;
    }
  }
  Error.throwWithStackTrace(lastError!, StackTrace.current);
}
