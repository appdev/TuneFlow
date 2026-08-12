import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/search/search_repository.dart';
import 'package:musicfree_service_client/features/search/search_controller.dart'
    as feature;

void main() {
  final origin = Platform.environment['LX_SERVICE_ORIGIN'];
  final source = Platform.environment['LX_TEST_SOURCE'];
  final query = Platform.environment['LX_TEST_QUERY'];
  test(
    'connects to a real Service and performs resource operations',
    () async {
      if (origin == null) return;
      expect(
        source,
        isNotNull,
        reason: 'LX_TEST_SOURCE is required with LX_SERVICE_ORIGIN.',
      );
      expect(
        query,
        isNotNull,
        reason: 'LX_TEST_QUERY is required with LX_SERVICE_ORIGIN.',
      );
      final connected = await ConnectionRepository().connect(origin);
      final playlists = PlaylistRepository(connected.api);
      final downloads = DownloadRepository(connected.api);
      final search = SearchRepository(connected.api);
      final aggregate = feature.SearchController(search);
      final playback = PlaybackRepository(connected.api);
      final id = 'flutter_acceptance_${DateTime.now().microsecondsSinceEpoch}';
      try {
        expect(connected.capabilities.apiVersion, 'v1');
        await aggregate.loadCapabilities();
        expect(
          aggregate.state.providers.map((provider) => provider.id),
          containsAll(['kw', 'kg', 'tx', 'wy', 'mg']),
        );
        await aggregate.search(
          source: feature.SearchController.aggregateSource,
          query: query!,
        );
        expect(aggregate.state.tracks, isNotEmpty);
        expect(
          aggregate.state.tracks.map((track) => track.source).toSet().length,
          greaterThan(1),
        );
        final result = await search.search(
          source: source!,
          text: query,
          page: 1,
          pageSize: 30,
        );
        expect(result.tracks, isNotEmpty);
        expect(result.tracks.every((track) => track.id.isNotEmpty), isTrue);
        final track = result.tracks.first;

        final lyrics = await search.lyrics(track);
        expect(lyrics.original, isNotEmpty);
        expect(
          lyrics.original.contains('\uFFFD'),
          isFalse,
          reason: 'Service lyrics must remain valid Unicode in Flutter.',
        );

        await playlists.create(id: id, name: 'Flutter Acceptance');
        var detail = await playlists.get(id);
        expect(detail.name, 'Flutter Acceptance');
        expect(detail.tracks, isEmpty);
        await playlists.addTracks(id, [track]);
        detail = await playlists.get(id);
        expect(detail.tracks.single.id, track.id);
        await playlists.reorderTracks(id, 0, [track.id]);
        await playlists.removeTracks(id, [track.id]);
        detail = await playlists.get(id);
        expect(detail.tracks, isEmpty);

        expect(await downloads.list(), isA<List>());
        final sourceResult = await playback.resolve(track, '128k');
        expect(sourceResult.streamUri.origin, connected.origin.uri.origin);
        expect(
          sourceResult.streamUri.path,
          anyOf(
            startsWith('/api/v1/streams/'),
            matches(RegExp(r'^/api/v1/library/tracks/[^/]+/stream$')),
          ),
        );
        final http = HttpClient();
        try {
          final request = await http.getUrl(sourceResult.streamUri);
          request.headers.set(HttpHeaders.rangeHeader, 'bytes=0-1023');
          final response = await request.close();
          expect(
            response.statusCode,
            anyOf(HttpStatus.ok, HttpStatus.partialContent),
          );
          final bytes = await response.fold<int>(
            0,
            (length, chunk) => length + chunk.length,
          );
          expect(bytes, greaterThan(0));
        } finally {
          http.close(force: true);
        }
      } finally {
        try {
          await playlists.delete(id);
        } on Object {
          // The create operation may have failed before the resource existed.
        }
        connected.api.close();
        aggregate.dispose();
      }
    },
    skip: origin == null
        ? 'Set LX_SERVICE_ORIGIN to run real Service acceptance.'
        : false,
  );
}
