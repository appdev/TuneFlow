import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/client_data/client_data_repository.dart';
import 'package:musicfree_service_client/features/home/home_controller.dart';
import 'package:musicfree_service_client/features/library/library_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';

http.Response data(Object? value) =>
    http.Response(jsonEncode({'data': value}), 200);

void main() {
  test(
    'dashboard retains the successful resource when the other fails',
    () async {
      var downloadsFail = false;
      final api = ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient((request) async {
          if (request.url.path == '/api/v1/playlists') {
            return data([
              {'id': 'one', 'name': 'One'},
            ]);
          }
          if (downloadsFail) throw StateError('downloads offline');
          return data(<Object?>[]);
        }),
      );
      final controller = HomeController(
        playlists: PlaylistRepository(api),
        downloads: DownloadRepository(api),
        library: LibraryRepository(api),
      );

      await controller.refresh();
      downloadsFail = true;
      await controller.refresh();

      expect(controller.state.playlists.single.id, 'one');
      expect(controller.state.downloads, isEmpty);
      expect(controller.state.stale, isTrue);
      expect(controller.state.error, isNotNull);
    },
  );

  test(
    'dashboard maps valid playback history and ignores malformed entries',
    () async {
      final api = ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient((request) async {
          if (request.url.path.contains('client-data')) {
            return data([
              {
                'id': 'history-1',
                'name': 'Night Wind',
                'singer': 'Artist',
                'source': 'kw',
                'playedAt': 123,
              },
              {'id': 'broken', 'source': 'kw'},
            ]);
          }
          return data(<Object?>[]);
        }),
      );
      final controller = HomeController(
        playlists: PlaylistRepository(api),
        downloads: DownloadRepository(api),
        library: LibraryRepository(api),
        history: ClientDataRepository(api),
      );

      await controller.refresh();

      expect(controller.state.error, isNull);
      expect(controller.state.continueListening.single.id, 'history-1');
      expect(controller.state.featured.single.id, 'history-1');
      expect(controller.state.lastSyncedAt, isNotNull);
    },
  );
}
