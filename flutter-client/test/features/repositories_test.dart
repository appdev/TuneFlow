import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_exception.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/search/search_repository.dart';

ServiceApi apiWith(
  Future<http.Response> Function(http.Request request) handler,
) => ServiceApi(
  ServiceOrigin.parse('http://service.local'),
  client: MockClient(handler),
);

http.Response data(Object? value, [int status = 200]) =>
    http.Response(jsonEncode({'data': value}), status);

void main() {
  test('connection checks health then v1 capabilities', () async {
    final paths = <String>[];
    final repository = ConnectionRepository(
      (origin) => apiWith((request) async {
        paths.add(request.url.path);
        return request.url.path.endsWith('health')
            ? data({'status': 'ok'})
            : data({
                'runtime': 'service',
                'apiVersion': 'v1',
                'features': <String, Object?>{},
              });
      }),
    );

    final connected = await repository.connect('http://service.local/');

    expect(paths, ['/api/v1/health', '/api/v1/capabilities']);
    expect(connected.origin.uri.toString(), 'http://service.local');
  });

  test(
    'playlist listing explicitly requests the complete Service library',
    () async {
      late http.Request call;
      final repository = PlaylistRepository(
        apiWith((request) async {
          call = request;
          return data([
            {'id': 'default', 'name': 'list__name_default'},
            {'id': 'love', 'name': 'list__name_love'},
          ]);
        }),
      );

      final playlists = await repository.list();

      expect(call.url.path, '/api/v1/playlists');
      expect(call.url.queryParameters, {'includeBuiltIn': 'true'});
      expect(playlists.map((playlist) => playlist.id), ['default', 'love']);
    },
  );

  test('search, lyrics and picture map only current catalog routes', () async {
    final calls = <http.Request>[];
    final repository = SearchRepository(
      apiWith((request) async {
        calls.add(request);
        if (request.url.path.endsWith('search')) {
          return data({
            'list': [
              {'id': '1', 'name': 'Song', 'source': 'kw'},
            ],
            'total': 1,
          });
        }
        if (request.url.path.endsWith('picture')) {
          return data({'url': 'https://image'});
        }
        return data({'lyric': 'line'});
      }),
    );
    final page = await repository.search(
      source: 'kw',
      text: 'fixture',
      page: 1,
      pageSize: 30,
    );
    final lyrics = await repository.lyrics(page.tracks.single);
    await repository.picture(page.tracks.single);

    expect(calls.map((e) => e.url.path), [
      '/api/v1/catalog/tracks/search',
      '/api/v1/catalog/tracks/lyrics',
      '/api/v1/catalog/tracks/picture',
    ]);
    expect(jsonDecode(calls.first.body), {
      'source': 'kw',
      'text': 'fixture',
      'page': 1,
      'pageSize': 30,
    });
    expect(page.total, 1);
    expect(lyrics.original, 'line');
  });

  test(
    'catalog capability gates and collection searches use typed routes',
    () async {
      final calls = <http.Request>[];
      final repository = SearchRepository(
        apiWith((request) async {
          calls.add(request);
          if (request.method == 'GET') {
            return data({
              'sources': [
                {
                  'id': 'wy',
                  'name': 'NetEase',
                  'searchKinds': ['track', 'playlist', 'album'],
                },
              ],
            });
          }
          return data({
            'list': [
              {'id': 'a1', 'kind': 'album', 'name': 'A', 'source': 'wy'},
            ],
            'total': 1,
          });
        }),
      );

      final capabilities = await repository.capabilities();
      final albums = await repository.searchCollections(
        kind: CatalogSearchKind.album,
        source: 'wy',
        text: 'fixture',
        page: 1,
        pageSize: 20,
      );

      expect(
        capabilities.providers.single.searchKinds,
        contains(CatalogSearchKind.album),
      );
      expect(albums.items.single.id, 'a1');
      expect(calls.map((request) => request.url.path), [
        '/api/v1/catalog/capabilities',
        '/api/v1/catalog/albums/search',
      ]);
    },
  );

  test('leaderboards use Service catalog routes', () async {
    final calls = <http.Request>[];
    final repository = SearchRepository(
      apiWith((request) async {
        calls.add(request);
        if (request.url.path.endsWith('/leaderboards')) {
          return data({
            'list': [
              {'id': 'kw__16', 'bangid': '16', 'name': 'Hot chart'},
            ],
            'source': 'kw',
          });
        }
        return data({
          'list': [
            {
              'songmid': 'song-1',
              'name': 'Song',
              'source': 'kw',
              'img': 'https://cdn.example.test/song.jpg',
            },
          ],
          'total': 1,
          'limit': 30,
          'page': 1,
          'source': 'kw',
        });
      }),
    );

    final boards = await repository.leaderboards(source: 'kw');
    final tracks = await repository.leaderboardTracks(
      source: 'kw',
      boardId: boards.items.single.providerId,
      page: 1,
    );

    expect(tracks.tracks.single.raw['pic'], isNotNull);
    expect(calls.map((request) => request.url.path), [
      '/api/v1/catalog/leaderboards',
      '/api/v1/catalog/leaderboards/tracks',
    ]);
  });

  test('playlist repository uses resource routes', () async {
    final calls = <http.Request>[];
    final repository = PlaylistRepository(
      apiWith((request) async {
        calls.add(request);
        if (request.url.path == '/api/v1/playlists') return data([]);
        return data({'id': 'a/b', 'name': 'A', 'tracks': <Object?>[]});
      }),
    );

    await repository.list();
    await repository.get('a/b');

    expect(calls[1].url.path, '/api/v1/playlists/a%2Fb');
    expect(calls.every((e) => !e.url.path.contains('/actions/')), isTrue);
  });

  test('playlist reorder sends the Service-required position', () async {
    late http.Request captured;
    final repository = PlaylistRepository(
      apiWith((request) async {
        captured = request;
        return data(<Object?>[]);
      }),
    );

    await repository.reorderTracks('road trip', 2, ['track-1']);

    expect(captured.url.path, '/api/v1/playlists/road%20trip/tracks/reorder');
    expect(jsonDecode(captured.body), {
      'position': 2,
      'trackIds': ['track-1'],
    });
  });

  test(
    'playback accepts Service proxy and local-library stream paths',
    () async {
      var url = '/api/v1/streams/token';
      final repository = PlaybackRepository(
        apiWith(
          (_) async => data({'url': url, 'quality': '128k', 'expiresAt': 1000}),
        ),
      );
      final track = Track.fromJson({'id': '1', 'source': 'kw'});

      final resolved = await repository.resolve(track, '128k');
      expect(
        resolved.streamUri.toString(),
        'http://service.local/api/v1/streams/token',
      );

      url = '/api/v1/library/tracks/${List.filled(64, 'a').join()}/stream';
      final local = await repository.resolve(track, '128k');
      expect(local.streamUri.path, url);

      url = 'https://upstream.example/song.mp3';
      await expectLater(
        repository.resolve(track, '128k'),
        throwsA(
          isA<ServiceException>().having(
            (e) => e.code,
            'code',
            'INVALID_STREAM_URL',
          ),
        ),
      );
    },
  );

  test('download create sends no client filesystem fields', () async {
    late http.Request captured;
    final repository = DownloadRepository(
      apiWith((request) async {
        captured = request;
        return data({
          'id': 'd1',
          'status': 'waiting',
          'musicInfo': {'id': '1'},
          'quality': '128k',
          'extension': 'mp3',
          'fileName': 'song.mp3',
          'downloaded': 0,
          'total': 0,
          'progress': 0,
          'queuePosition': 1,
          'createdAt': 1000,
          'updatedAt': 1000,
        }, 201);
      }),
    );

    await repository.create(
      Track.fromJson({'id': '1', 'source': 'kw'}),
      '128k',
    );
    final body = jsonDecode(captured.body) as Map<String, Object?>;
    expect(body.keys, containsAll(<String>['musicInfo', 'quality']));
    expect(body.keys, isNot(contains('path')));
    expect(body.keys, isNot(contains('fileName')));
  });
}
