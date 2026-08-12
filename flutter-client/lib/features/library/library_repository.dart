import '../../api/models.dart';
import '../../api/service_api.dart';

final class LibraryRepository {
  const LibraryRepository(this.api);
  final ServiceApi api;

  Future<List<LibraryTrack>> list() async => jsonList(
    await api.request('GET', '/api/v1/library/tracks'),
    'library',
  ).map(LibraryTrack.fromJson).toList(growable: false);

  Future<List<LibraryTrack>> scan() async => jsonList(
    await api.request('POST', '/api/v1/library/scan'),
    'library',
  ).map(LibraryTrack.fromJson).toList(growable: false);

  Uri streamUri(LibraryTrack track) => api.origin.resolve(track.streamPath);
}
