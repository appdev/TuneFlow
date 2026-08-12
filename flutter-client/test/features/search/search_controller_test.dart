import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/search/search_controller.dart';
import 'package:musicfree_service_client/features/search/search_repository.dart';

http.Response page(List<String> ids, {int total = 60}) => http.Response(
  jsonEncode({
    'data': {
      'list': ids.map((id) => {'id': id, 'name': id, 'source': 'kw'}).toList(),
      'total': total,
    },
  }),
  200,
);

SearchController controllerWith(
  Future<http.Response> Function(http.Request request) handler,
) => SearchController(
  SearchRepository(
    ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient(handler),
    ),
  ),
);

void main() {
  test(
    'single-source overview loads supported sections independently',
    () async {
      final requestedPaths = <String>[];
      final controller = controllerWith((request) async {
        requestedPaths.add(request.url.path);
        if (request.url.path.contains('/tracks/')) {
          return page(['track-1'], total: 1);
        }
        if (request.url.path.contains('/albums/')) {
          return http.Response(
            jsonEncode({
              'data': {
                'list': [
                  {
                    'id': 'album-1',
                    'kind': 'album',
                    'name': 'Album',
                    'source': 'wy',
                  },
                ],
                'total': 1,
              },
            }),
            200,
          );
        }
        return http.Response('failure', 500);
      });
      controller.state = const SearchState(
        source: 'wy',
        providers: [
          CatalogProvider(
            id: 'wy',
            name: '网易音乐',
            searchKinds: {
              CatalogSearchKind.track,
              CatalogSearchKind.album,
              CatalogSearchKind.playlist,
            },
          ),
        ],
      );

      await controller.search(source: 'wy', query: 'wind');

      expect(
        requestedPaths,
        containsAll([
          '/api/v1/catalog/tracks/search',
          '/api/v1/catalog/albums/search',
          '/api/v1/catalog/playlists/search',
        ]),
      );
      expect(controller.state.trackSection.items.single.id, 'track-1');
      expect(controller.state.albumSection.items.single.id, 'album-1');
      expect(controller.state.playlistSection.phase, SearchPhase.failure);
    },
  );

  test('aggregate search reports partial provider status', () async {
    final controller = controllerWith((request) async {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      if (body['source'] == 'kg') return http.Response('offline', 500);
      return http.Response(
        jsonEncode({
          'data': {
            'list': [
              {'id': 'wind', 'name': 'Wind', 'source': body['source']},
            ],
            'total': 1,
          },
        }),
        200,
      );
    });
    controller.state = const SearchState(
      providers: [
        CatalogProvider(
          id: 'kw',
          name: '酷我',
          searchKinds: {CatalogSearchKind.track},
        ),
        CatalogProvider(
          id: 'kg',
          name: '酷狗',
          searchKinds: {CatalogSearchKind.track},
        ),
      ],
    );

    await controller.search(source: 'all', query: 'wind');

    expect(controller.state.tracks, hasLength(1));
    expect(controller.state.providerStatuses.map((item) => item.phase), [
      ProviderSearchPhase.success,
      ProviderSearchPhase.failure,
    ]);
  });

  test(
    'aggregate search queries every provider and deduplicates tracks',
    () async {
      final requestedSources = <String>[];
      final controller = controllerWith((request) async {
        final body = jsonDecode(request.body) as Map<String, Object?>;
        final source = body['source']! as String;
        requestedSources.add(source);
        return http.Response(
          jsonEncode({
            'data': {
              'list': [
                {'id': 'shared', 'name': 'Shared', 'source': source},
                {'id': '$source-only', 'name': source, 'source': source},
              ],
              'total': 2,
            },
          }),
          200,
        );
      });
      controller.state = const SearchState(
        providers: [
          CatalogProvider(
            id: 'kw',
            name: '酷我音乐',
            searchKinds: {CatalogSearchKind.track},
          ),
          CatalogProvider(
            id: 'kg',
            name: '酷狗音乐',
            searchKinds: {CatalogSearchKind.track},
          ),
          CatalogProvider(
            id: 'tx',
            name: 'QQ音乐',
            searchKinds: {CatalogSearchKind.track},
          ),
          CatalogProvider(
            id: 'wy',
            name: '网易音乐',
            searchKinds: {CatalogSearchKind.track},
          ),
          CatalogProvider(
            id: 'mg',
            name: '咪咕音乐',
            searchKinds: {CatalogSearchKind.track},
          ),
        ],
      );

      await controller.search(source: 'all', query: 'wind');

      expect(requestedSources, ['kw', 'kg', 'tx', 'wy', 'mg']);
      expect(controller.state.source, 'all');
      expect(controller.state.tracks, hasLength(10));
      expect(controller.state.phase, SearchPhase.results);
    },
  );

  test('page two appends while a new query replaces results', () async {
    final controller = controllerWith((request) async {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      final query = body['text']! as String;
      final pageNumber = body['page']! as int;
      return page(['$query-$pageNumber']);
    });

    await controller.search(source: 'kw', query: 'first');
    await controller.loadNextPage();
    expect(controller.state.tracks.map((track) => track.id), [
      'first-1',
      'first-2',
    ]);

    await controller.search(source: 'kw', query: 'second');
    expect(controller.state.tracks.map((track) => track.id), ['second-1']);
  });

  test(
    'concurrent next-page calls collapse and failure retains tracks',
    () async {
      final pageTwo = Completer<http.Response>();
      var calls = 0;
      final controller = controllerWith((request) async {
        calls++;
        if (calls == 1) return page(['one']);
        if (calls == 2) return pageTwo.future;
        throw StateError('unexpected request');
      });
      await controller.search(source: 'kw', query: 'song');

      final first = controller.loadNextPage();
      final second = controller.loadNextPage();
      await Future<void>.delayed(Duration.zero);
      pageTwo.completeError(StateError('offline'));
      await Future.wait([first, second]);

      expect(calls, 2);
      expect(controller.state.tracks.single.id, 'one');
      expect(controller.state.phase, SearchPhase.failure);
      expect(controller.state.error, isNotNull);
    },
  );

  test('empty query never calls Service', () async {
    var calls = 0;
    final controller = controllerWith((_) async {
      calls++;
      return page([]);
    });

    await controller.search(source: 'kw', query: '   ');

    expect(calls, 0);
    expect(controller.state.phase, SearchPhase.idle);
  });

  test(
    'switching categories restores cached results and falls back by source',
    () async {
      final controller = controllerWith((request) async {
        if (request.url.path.endsWith('/capabilities')) {
          return http.Response(
            jsonEncode({
              'data': {
                'sources': [
                  {
                    'id': 'kw',
                    'name': 'Kuwo',
                    'searchKinds': ['track'],
                  },
                  {
                    'id': 'wy',
                    'name': 'NetEase',
                    'searchKinds': ['track', 'album'],
                  },
                ],
              },
            }),
            200,
          );
        }
        if (request.url.path.contains('/albums/')) {
          return http.Response(
            jsonEncode({
              'data': {
                'list': [
                  {
                    'id': 'album-1',
                    'kind': 'album',
                    'name': 'Album',
                    'source': 'wy',
                  },
                ],
                'total': 1,
              },
            }),
            200,
          );
        }
        return page(['track-1'], total: 1);
      });
      await controller.loadCapabilities();
      await controller.search(source: 'wy', query: 'wind');
      await controller.selectKind(CatalogSearchKind.album);
      expect(controller.state.collections.single.id, 'album-1');

      await controller.selectKind(CatalogSearchKind.track);
      expect(controller.state.tracks.single.id, 'track-1');
      expect(
        controller.cachedPage('wy', CatalogSearchKind.album, 'wind'),
        isNotNull,
      );

      await controller.search(source: 'kw', query: 'wind');
      expect(controller.state.kind, CatalogSearchKind.track);
    },
  );
}
