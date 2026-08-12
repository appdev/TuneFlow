import '../../api/models.dart';
import '../../api/service_api.dart';

final class SearchRepository {
  const SearchRepository(this.api);
  final ServiceApi api;

  Future<CatalogCapabilities> capabilities() async =>
      CatalogCapabilities.fromJson(
        await api.request('GET', '/api/v1/catalog/capabilities'),
      );

  Future<SearchPage> search({
    required String source,
    required String text,
    required int page,
    required int pageSize,
  }) async {
    final value = await api.request(
      'POST',
      '/api/v1/catalog/tracks/search',
      body: {
        'source': source,
        'text': text,
        'page': page,
        'pageSize': pageSize,
      },
    );
    return SearchPage.fromJson(value);
  }

  Future<CollectionSearchPage> searchCollections({
    required CatalogSearchKind kind,
    required String source,
    required String text,
    required int page,
    required int pageSize,
  }) async {
    if (kind == CatalogSearchKind.track) {
      throw ArgumentError.value(kind, 'kind', 'Use search for tracks.');
    }
    final segment = kind == CatalogSearchKind.playlist ? 'playlists' : 'albums';
    return CollectionSearchPage.fromJson(
      await api.request(
        'POST',
        '/api/v1/catalog/$segment/search',
        body: {
          'source': source,
          'text': text,
          'page': page,
          'pageSize': pageSize,
        },
      ),
    );
  }

  Future<Lyrics> lyrics(Track track) async => Lyrics.fromJson(
    await api.request(
      'POST',
      '/api/v1/catalog/tracks/lyrics',
      body: {'source': track.source, 'musicInfo': track.toJson()},
    ),
  );

  Future<LeaderboardPage> leaderboards({required String source}) async =>
      LeaderboardPage.fromJson(
        await api.request(
          'POST',
          '/api/v1/catalog/leaderboards',
          body: {'source': source},
        ),
      );

  Future<LeaderboardTrackPage> leaderboardTracks({
    required String source,
    required String boardId,
    required int page,
  }) async => LeaderboardTrackPage.fromJson(
    await api.request(
      'POST',
      '/api/v1/catalog/leaderboards/tracks',
      body: {'source': source, 'boardId': boardId, 'page': page},
    ),
  );

  Future<String> picture(Track track) async {
    final value = await api.request(
      'POST',
      '/api/v1/catalog/tracks/picture',
      body: {'source': track.source, 'musicInfo': track.toJson()},
    );
    final json = jsonObject(value, 'picture');
    return jsonString(json['url'], 'picture.url');
  }
}
