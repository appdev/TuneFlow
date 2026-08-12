import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/features/playlists/playlist_detail_controller.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlists_controller.dart';

http.Response data(Object? value, [int status = 200]) =>
    http.Response(jsonEncode({'data': value}), status);

PlaylistRepository repositoryWith(
  Future<http.Response> Function(http.Request request) handler,
) => PlaylistRepository(
  ServiceApi(
    ServiceOrigin.parse('http://service.local'),
    client: MockClient(handler),
  ),
);

void main() {
  test(
    'refresh resolves each Service playlist detail for count and artwork',
    () async {
      final controller = PlaylistsController(
        repositoryWith((request) async {
          if (request.url.path == '/api/v1/playlists') {
            return data([
              {'id': 'love', 'name': 'list__name_love'},
            ]);
          }
          return data({
            'id': 'love',
            'name': 'love',
            'tracks': [
              {
                'id': 'track-1',
                'name': 'Song',
                'source': 'kw',
                'img': 'https://cdn.example.test/song.jpg',
              },
            ],
          });
        }),
      );

      await controller.refresh();

      final detail = controller.state.items.single;
      expect(detail.tracks, hasLength(1));
      expect(
        detail.tracks.single.raw['pic'],
        'https://cdn.example.test/song.jpg',
      );
    },
  );

  test(
    'refresh failure retains usable playlists and marks them stale',
    () async {
      var fail = false;
      final controller = PlaylistsController(
        repositoryWith((request) async {
          if (fail) throw StateError('offline');
          return request.url.path == '/api/v1/playlists'
              ? data([
                  {'id': 'one', 'name': 'One'},
                ])
              : data({'id': 'one', 'name': 'One', 'tracks': <Object?>[]});
        }),
      );

      await controller.refresh();
      fail = true;
      await controller.refresh();

      expect(controller.state.items.single.id, 'one');
      expect(controller.state.stale, isTrue);
      expect(controller.state.error, isNotNull);
    },
  );

  test('create and delete always finish with an authoritative list', () async {
    final calls = <String>[];
    var listCount = 0;
    final controller = PlaylistsController(
      repositoryWith((request) async {
        calls.add('${request.method} ${request.url.path}');
        if (request.method == 'POST') return data([], 201);
        if (request.method == 'DELETE') return data(null, 204);
        if (request.url.path == '/api/v1/playlists') {
          listCount++;
          return data([
            {'id': 'list-$listCount', 'name': 'List $listCount'},
          ]);
        }
        return data({
          'id': 'list-$listCount',
          'name': 'List $listCount',
          'tracks': <Object?>[],
        });
      }),
      idFactory: () => 'flutter_test',
    );

    await controller.create(name: 'Road trip');
    expect(controller.state.items.single.id, 'list-1');
    await controller.delete('list-1');
    expect(controller.state.items.single.id, 'list-2');
    expect(calls, [
      'POST /api/v1/playlists',
      'GET /api/v1/playlists',
      'GET /api/v1/playlists/list-1',
      'DELETE /api/v1/playlists/list-1',
      'GET /api/v1/playlists',
      'GET /api/v1/playlists/list-2',
    ]);
  });

  test(
    'detail mutations refresh Service order and playback uses that order',
    () async {
      final calls = <http.Request>[];
      var load = 0;
      final controller = PlaylistDetailController(
        repositoryWith((request) async {
          calls.add(request);
          if (request.url.path.endsWith('/tracks/remove') ||
              request.url.path.endsWith('/tracks/reorder')) {
            return data([]);
          }
          load++;
          return data({
            'id': 'p1',
            'name': 'Mix',
            'tracks': [
              {'id': 'track-$load-a', 'name': 'A'},
              {'id': 'track-$load-b', 'name': 'B'},
            ],
          });
        }),
        'p1',
      );
      final played = <String>[];

      await controller.refresh();
      await controller.remove('track-1-a');
      await controller.reorder(position: 1, trackIds: ['track-2-a']);
      await controller.playAll((tracks, {startIndex = 0}) async {
        played.addAll(tracks.map((track) => track.id));
        played.add('start:$startIndex');
      });

      expect(played, ['track-3-a', 'track-3-b', 'start:0']);
      expect(jsonDecode(calls[3].body), {
        'position': 1,
        'trackIds': ['track-2-a'],
      });
    },
  );

  test(
    'detail rename patches the resource and refreshes authoritative data',
    () async {
      final calls = <http.Request>[];
      var name = 'Before';
      final controller = PlaylistDetailController(
        repositoryWith((request) async {
          calls.add(request);
          if (request.method == 'PATCH') {
            name =
                (jsonDecode(request.body) as Map<String, Object?>)['name']!
                    as String;
          }
          return data({'id': 'p1', 'name': name, 'tracks': <Object?>[]});
        }),
        'p1',
      );

      await controller.refresh();
      await controller.rename('After');

      expect(calls.map((request) => request.method), ['GET', 'PATCH', 'GET']);
      expect(jsonDecode(calls[1].body), {'name': 'After'});
      expect(controller.state.detail?.name, 'After');
    },
  );
}
