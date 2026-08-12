import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/search/search_controller.dart'
    as feature;
import 'package:musicfree_service_client/features/search/search_repository.dart';

void main() {
  final origin = Platform.environment['LX_SERVICE_ORIGIN'];
  final query = Platform.environment['LX_TEST_QUERY'] ?? '周杰伦';

  test(
    'every advertised catalog source returns client-consumable results',
    () async {
      final connected = await ConnectionRepository().connect(origin!);
      final repository = SearchRepository(connected.api);
      final aggregate = feature.SearchController(repository);
      try {
        final capabilities = await repository.capabilities();
        expect(
          capabilities.providers.map((provider) => provider.id),
          containsAll(['kw', 'kg', 'tx', 'wy', 'mg']),
        );

        for (final provider in capabilities.providers) {
          final page = await repository.search(
            source: provider.id,
            text: query,
            page: 1,
            pageSize: 5,
          );
          expect(page.tracks, isNotEmpty, reason: provider.name);
          final track = page.tracks.first;
          final embedded = track.raw['pic'];
          final picture = embedded is String && embedded.isNotEmpty
              ? Uri.parse(embedded)
              : Uri.parse(await repository.picture(track));
          expect(
            picture.scheme,
            anyOf('http', 'https'),
            reason: '${provider.name} artwork',
          );

          if (provider.searchKinds.contains(CatalogSearchKind.playlist)) {
            final playlists = await repository.searchCollections(
              kind: CatalogSearchKind.playlist,
              source: provider.id,
              text: query,
              page: 1,
              pageSize: 5,
            );
            expect(playlists.items, isNotEmpty, reason: provider.name);
          }
          if (provider.searchKinds.contains(CatalogSearchKind.album)) {
            final albums = await repository.searchCollections(
              kind: CatalogSearchKind.album,
              source: provider.id,
              text: query,
              page: 1,
              pageSize: 5,
            );
            expect(albums.items, isNotEmpty, reason: provider.name);
          }
        }

        await aggregate.loadCapabilities();
        await aggregate.search(
          source: feature.SearchController.aggregateSource,
          query: query,
        );
        expect(
          aggregate.state.providerStatuses.every(
            (status) => status.phase == feature.ProviderSearchPhase.success,
          ),
          isTrue,
        );
        expect(
          aggregate.state.tracks.map((track) => track.source).toSet(),
          containsAll(['kw', 'kg', 'tx', 'wy', 'mg']),
        );
      } finally {
        aggregate.dispose();
        connected.api.close();
      }
    },
    skip: origin == null
        ? 'Set LX_SERVICE_ORIGIN to run the real catalog matrix.'
        : false,
  );
}
