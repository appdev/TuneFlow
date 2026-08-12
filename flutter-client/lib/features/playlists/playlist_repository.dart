import '../../api/models.dart';
import '../../api/service_api.dart';

final class PlaylistRepository {
  const PlaylistRepository(this.api);
  final ServiceApi api;
  String _playlist(String id) => '/api/v1/playlists/${Uri.encodeComponent(id)}';

  Future<List<PlaylistSummary>> list() async => jsonList(
    await api.request('GET', '/api/v1/playlists?includeBuiltIn=true'),
    'playlists',
  ).map(PlaylistSummary.fromJson).toList(growable: false);

  Future<PlaylistDetail> get(String id) async =>
      PlaylistDetail.fromJson(await api.request('GET', _playlist(id)));

  Future<List<PlaylistDetail>> listDetails() async {
    final playlists = await list();
    return Future.wait(playlists.map((playlist) => get(playlist.id)));
  }

  Future<List<PlaylistSummary>> create({
    required String id,
    required String name,
    int position = 0,
  }) async => jsonList(
    await api.request(
      'POST',
      '/api/v1/playlists',
      body: {
        'position': position,
        'playlists': [
          {'id': id, 'name': name},
        ],
      },
    ),
    'playlists',
  ).map(PlaylistSummary.fromJson).toList(growable: false);

  Future<void> delete(String id) => api.request('DELETE', _playlist(id));

  Future<void> update(String id, String name) =>
      api.request('PATCH', _playlist(id), body: {'name': name});

  Future<List<Track>> addTracks(String id, List<Track> tracks) async =>
      jsonList(
        await api.request(
          'POST',
          '${_playlist(id)}/tracks',
          body: {
            'tracks': tracks.map((track) => track.toJson()).toList(),
            'position': 'bottom',
          },
        ),
        'tracks',
      ).map(Track.fromJson).toList(growable: false);

  Future<List<Track>> removeTracks(String id, List<String> trackIds) async =>
      jsonList(
        await api.request(
          'POST',
          '${_playlist(id)}/tracks/remove',
          body: {'trackIds': trackIds},
        ),
        'tracks',
      ).map(Track.fromJson).toList(growable: false);

  Future<List<Track>> reorderTracks(
    String id,
    int position,
    List<String> trackIds,
  ) async => jsonList(
    await api.request(
      'POST',
      '${_playlist(id)}/tracks/reorder',
      body: {'position': position, 'trackIds': trackIds},
    ),
    'tracks',
  ).map(Track.fromJson).toList(growable: false);
}
