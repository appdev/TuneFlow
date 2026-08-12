import '../../api/models.dart';
import '../../api/service_api.dart';

final class ClientDataRepository {
  const ClientDataRepository(this.api);
  final ServiceApi api;

  static const playbackHistoryKey = 'flutter.playback-history.v1';

  Future<Object?> read(String key) =>
      api.request('GET', '/api/v1/client-data/${Uri.encodeComponent(key)}');

  Future<Object?> write(String key, Object? value) => api.request(
    'PUT',
    '/api/v1/client-data/${Uri.encodeComponent(key)}',
    body: {'value': value},
  );

  Future<void> recordPlayback(Track track) async {
    final current = await read(playbackHistoryKey);
    final items = current is List
        ? current
              .whereType<Map>()
              .map((item) => Map<String, Object?>.from(item))
              .toList()
        : <Map<String, Object?>>[];
    items.removeWhere(
      (item) => item['id'] == track.id && item['source'] == track.source,
    );
    items.insert(0, {
      ...track.toJson(),
      'playedAt': DateTime.now().millisecondsSinceEpoch,
    });
    await write(playbackHistoryKey, items.take(50).toList(growable: false));
  }

  Future<List<PlaybackHistoryEntry>> readPlaybackHistory() async {
    final current = await read(playbackHistoryKey);
    if (current is! List) return const [];
    final result = <PlaybackHistoryEntry>[];
    for (final item in current) {
      if (item is! Map) continue;
      final json = Map<String, Object?>.from(item);
      if (json['id'] is! String ||
          (json['id']! as String).isEmpty ||
          json['source'] is! String ||
          (json['source']! as String).isEmpty ||
          json['playedAt'] is! num) {
        continue;
      }
      try {
        result.add(
          PlaybackHistoryEntry(
            track: Track.fromJson(json),
            playedAt: DateTime.fromMillisecondsSinceEpoch(
              (json['playedAt']! as num).toInt(),
            ),
          ),
        );
      } on Object {
        continue;
      }
      if (result.length == 50) break;
    }
    return List.unmodifiable(result);
  }
}

final class PlaybackHistoryEntry {
  const PlaybackHistoryEntry({required this.track, required this.playedAt});

  final Track track;
  final DateTime playedAt;
}
