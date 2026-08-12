import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/service_exception.dart';

void main() {
  test('Track preserves provider metadata while requiring an id', () {
    final track = Track.fromJson({
      'id': 'kw_1',
      'name': 'Song',
      'singer': 'Artist',
      'source': 'kw',
      'interval': '03:30',
      'providerOnly': {'albumId': 'a1'},
    });

    expect(track.id, 'kw_1');
    expect(track.title, 'Song');
    expect(track.artist, 'Artist');
    expect(track.raw['providerOnly'], {'albumId': 'a1'});
    expect(
      () => Track.fromJson({'name': 'missing'}),
      throwsA(isA<ServiceException>()),
    );
  });

  test('Track normalizes LX provider songmid for resource API writes', () {
    final track = Track.fromJson({
      'songmid': '48214177',
      'name': 'Provider result',
      'source': 'kw',
    });

    expect(track.id, '48214177');
    expect(track.toJson()['songmid'], '48214177');
    expect(track.toJson()['id'], '48214177');
  });

  test('Track normalizes the Service img field for artwork consumers', () {
    const url = 'https://cdn.example.test/cover.jpg';
    final track = Track.fromJson({
      'songmid': 'cover-1',
      'name': 'Cover song',
      'source': 'wy',
      'img': url,
    });

    expect(track.raw['pic'], url);
  });

  test('Track normalizes persisted meta.picUrl for artwork consumers', () {
    const url = 'https://cdn.example.test/persisted-cover.jpg';
    final track = Track.fromJson({
      'id': 'cover-2',
      'name': 'Persisted song',
      'source': 'kw',
      'meta': {'picUrl': url},
    });

    expect(track.raw['pic'], url);
  });

  test('Leaderboard pages retain board ids and real track artwork', () {
    final boards = LeaderboardPage.fromJson({
      'list': [
        {'id': 'wy__3778678', 'bangid': '3778678', 'name': '热歌榜'},
      ],
      'source': 'wy',
    });
    final tracks = LeaderboardTrackPage.fromJson({
      'list': [
        {
          'songmid': 'song-1',
          'name': '真实歌曲',
          'source': 'wy',
          'img': 'https://cdn.example.test/song.jpg',
        },
      ],
      'total': 1,
      'page': 1,
      'limit': 30,
      'source': 'wy',
    });

    expect(boards.items.single.providerId, '3778678');
    expect(
      tracks.tracks.single.raw['pic'],
      'https://cdn.example.test/song.jpg',
    );
  });

  test('PlaylistDetail parses tracks and event snapshot is strict', () {
    final playlist = PlaylistDetail.fromJson({
      'id': 'list_1',
      'name': 'Favorites',
      'locationUpdateTime': null,
      'tracks': [
        {'id': 'track_1', 'name': 'One'},
      ],
    });
    final snapshot = EventSnapshot.fromJson({
      'sequence': 2,
      'events': [
        {'type': 'playlists.updated', 'data': [], 'sequence': 2},
      ],
    });

    expect(playlist.tracks.single.id, 'track_1');
    expect(snapshot.events.single.type, 'playlists.updated');
    expect(
      () => EventSnapshot.fromJson({'sequence': '2', 'events': []}),
      throwsA(isA<ServiceException>()),
    );
  });

  test('SearchPage normalizes provider ids and preserves total', () {
    final page = SearchPage.fromJson({
      'list': [
        {'songmid': 'm1', 'name': 'Song', 'source': 'kw'},
      ],
      'total': 31,
    });

    expect(page.tracks.single.id, 'm1');
    expect(page.total, 31);
    expect(
      () => SearchPage.fromJson({'list': 'invalid', 'total': 1}),
      throwsA(isA<ServiceException>()),
    );
  });

  test('Lyrics requires original text and accepts translation', () {
    final lyrics = Lyrics.fromJson({'lyric': 'line', 'tlyric': 'translated'});

    expect(lyrics.original, 'line');
    expect(lyrics.translation, 'translated');
    expect(
      () => Lyrics.fromJson({'lyric': 1}),
      throwsA(isA<ServiceException>()),
    );
  });

  test(
    'catalog capabilities and collection pages keep provider feature gates',
    () {
      final capabilities = CatalogCapabilities.fromJson({
        'sources': [
          {
            'id': 'wy',
            'name': '网易云音乐',
            'searchKinds': ['track', 'playlist', 'album'],
          },
        ],
      });
      final page = CollectionSearchPage.fromJson({
        'list': [
          {
            'id': 'album-1',
            'kind': 'album',
            'name': 'Album',
            'source': 'wy',
            'total': 12,
          },
        ],
        'total': 1,
      });

      expect(
        capabilities.providers.single.searchKinds,
        contains(CatalogSearchKind.album),
      );
      expect(page.items.single.kind, CatalogSearchKind.album);
      expect(page.items.single.total, 12);
    },
  );

  test('DownloadJob exposes strict status and legal actions', () {
    final paused = DownloadJob.fromJson({
      'id': 'd1',
      'status': 'paused',
      'musicInfo': {'id': 'm1', 'source': 'kw'},
      'quality': '128k',
      'extension': 'mp3',
      'fileName': 'Song.mp3',
      'downloaded': 50,
      'total': 100,
      'progress': 50,
      'queuePosition': null,
      'createdAt': 1000,
      'updatedAt': 2000,
    });

    expect(paused.status, DownloadStatus.paused);
    expect(paused.canResume, isTrue);
    expect(paused.canPause, isFalse);
    expect(paused.canDelete, isTrue);
    expect(paused.progress, .5);
    expect(
      () => DownloadJob.fromJson({...paused.raw, 'status': 'mystery'}),
      throwsA(isA<ServiceException>()),
    );
    expect(
      () => DownloadJob.fromJson({...paused.raw, 'progress': 101}),
      throwsA(isA<ServiceException>()),
    );
  });

  test('DownloadJob accepts Service snapshots without optional timestamps', () {
    final job = DownloadJob.fromJson({
      'id': 'legacy-download',
      'status': 'completed',
      'musicInfo': {
        'id': 'song',
        'name': 'Song',
        'singer': 'Artist',
        'source': 'kw',
      },
      'quality': '128k',
      'extension': 'mp3',
      'fileName': 'Song.mp3',
      'downloaded': 1024,
      'total': 1024,
      'progress': 100,
    });

    expect(job.createdAt, DateTime.fromMillisecondsSinceEpoch(0));
    expect(job.updatedAt, DateTime.fromMillisecondsSinceEpoch(0));
  });
}
