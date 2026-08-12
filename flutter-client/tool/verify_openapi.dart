import 'dart:convert';
import 'dart:io';

const usedOperations = <(String, String, String)>[
  ('GET', '/api/v1/health', 'getHealth'),
  ('GET', '/api/v1/capabilities', 'getCapabilities'),
  ('POST', '/api/v1/catalog/tracks/search', 'searchCatalogTracks'),
  ('POST', '/api/v1/catalog/tracks/lyrics', 'getCatalogTrackLyrics'),
  ('POST', '/api/v1/catalog/tracks/picture', 'getCatalogTrackPicture'),
  ('GET', '/api/v1/playlists', 'listPlaylists'),
  ('POST', '/api/v1/playlists', 'createPlaylists'),
  ('GET', '/api/v1/playlists/{id}', 'getPlaylist'),
  ('DELETE', '/api/v1/playlists/{id}', 'deletePlaylist'),
  ('POST', '/api/v1/playlists/{id}/tracks', 'addPlaylistTracks'),
  ('POST', '/api/v1/playlists/{id}/tracks/remove', 'removePlaylistTracks'),
  ('POST', '/api/v1/playlists/{id}/tracks/reorder', 'reorderPlaylistTracks'),
  ('POST', '/api/v1/playback/tracks/resolve', 'resolvePlaybackTrack'),
  ('GET', '/api/v1/streams/{token}', 'streamPlaybackTrack'),
  ('GET', '/api/v1/downloads', 'listDownloads'),
  ('POST', '/api/v1/downloads', 'createDownload'),
  ('DELETE', '/api/v1/downloads/{id}', 'deleteDownload'),
  ('POST', '/api/v1/downloads/{id}/start', 'startDownload'),
  ('POST', '/api/v1/downloads/{id}/pause', 'pauseDownload'),
  ('POST', '/api/v1/downloads/{id}/resume', 'resumeDownload'),
  ('GET', '/api/v1/events/snapshot', 'getEventSnapshot'),
  ('GET', '/api/v1/events', 'streamEvents'),
];

const forbidden = [
  '/api/v1/lists',
  '/api/v1/search',
  '/api/v1/lyrics',
  '/api/v1/stream/',
  '/api/v1/playback/resolve',
];

Never fail(String message) {
  stderr.writeln('OpenAPI verification failed: $message');
  exit(1);
}

void main(List<String> arguments) {
  final file = File(
    arguments.isEmpty
        ? '/Volumes/ext/lx-music-server-web/dist/server/openapi.json'
        : arguments.single,
  );
  if (!file.existsSync()) fail('missing ${file.path}');
  final document = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  final paths =
      document['paths'] as Map<String, Object?>? ?? fail('paths is missing');

  for (final (method, path, operationId) in usedOperations) {
    final operations = paths[path] as Map<String, Object?>?;
    if (operations == null || !operations.containsKey(method.toLowerCase())) {
      fail('$method $path is not present');
    }
    final operation = operations[method.toLowerCase()] as Map?;
    if (operation?['operationId'] != operationId) {
      fail('$method $path operationId is not $operationId');
    }
  }

  final operationIds = <String>{};
  for (final entry in paths.entries) {
    final operations = entry.value as Map<String, Object?>;
    for (final operation in operations.values.whereType<Map>()) {
      final id = operation['operationId'];
      if (id is String && !operationIds.add(id)) {
        fail('duplicate operationId $id');
      }
    }
  }

  final lib = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart'));
  for (final file in lib) {
    final source = file.readAsStringSync();
    for (final fragment in forbidden) {
      if (source.contains(fragment)) {
        fail('${file.path} contains legacy route $fragment');
      }
    }
  }
  stdout.writeln(
    'OpenAPI verified: ${usedOperations.length} Flutter operations, ${operationIds.length} unique operation IDs.',
  );
}
