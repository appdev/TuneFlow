import '../../api/models.dart';
import '../../api/service_api.dart';
import '../../api/service_exception.dart';

final class PlaybackSource {
  const PlaybackSource({required this.resolved, required this.streamUri});
  final ResolvedTrack resolved;
  final Uri streamUri;
}

abstract interface class PlaybackResolver {
  Future<PlaybackSource> resolve(Track track, String quality);
}

final class PlaybackRepository implements PlaybackResolver {
  const PlaybackRepository(this.api);
  final ServiceApi api;

  @override
  Future<PlaybackSource> resolve(Track track, String quality) async {
    final resolved = ResolvedTrack.fromJson(
      await api.request(
        'POST',
        '/api/v1/playback/tracks/resolve',
        body: {
          'source': track.source,
          'quality': quality,
          'info': track.toJson(),
        },
      ),
    );
    final url = resolved.url;
    final uri = Uri.tryParse(url);
    final segments = uri?.pathSegments ?? const <String>[];
    final proxyStream =
        segments.length == 4 &&
        segments[0] == 'api' &&
        segments[1] == 'v1' &&
        segments[2] == 'streams' &&
        segments[3].isNotEmpty;
    final libraryStream =
        segments.length == 6 &&
        segments[0] == 'api' &&
        segments[1] == 'v1' &&
        segments[2] == 'library' &&
        segments[3] == 'tracks' &&
        segments[4].isNotEmpty &&
        segments[5] == 'stream';
    if (uri == null ||
        !url.startsWith('/') ||
        uri.hasScheme ||
        uri.hasAuthority ||
        uri.hasQuery ||
        uri.hasFragment ||
        (!proxyStream && !libraryStream)) {
      throw const ServiceException(
        'INVALID_STREAM_URL',
        'Service returned an invalid playback stream URL.',
      );
    }
    return PlaybackSource(
      resolved: resolved,
      streamUri: api.origin.resolve(url),
    );
  }
}
