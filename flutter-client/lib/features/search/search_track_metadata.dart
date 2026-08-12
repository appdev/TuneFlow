import '../../api/models.dart';

final class SearchTrackMetadata {
  const SearchTrackMetadata({
    required this.album,
    required this.durationLabel,
    required this.qualityKey,
    required this.qualityLabel,
  });

  factory SearchTrackMetadata.fromTrack(Track track) {
    final qualityKey = _highestQuality(track.raw);
    return SearchTrackMetadata(
      album:
          _string(track.raw['albumName']) ?? _string(track.raw['album']) ?? '',
      durationLabel: _durationLabel(track.raw['interval']),
      qualityKey: qualityKey,
      qualityLabel: switch (qualityKey) {
        'flac24bit' => 'Hi-Res',
        'flac' => '无损',
        '320k' => '320K',
        _ => null,
      },
    );
  }

  final String album;
  final String? durationLabel;
  final String qualityKey;
  final String? qualityLabel;
}

String trackInitial(Track track) {
  final value = (track.title.trim().isEmpty ? track.id : track.title).trim();
  if (value.isEmpty) return '♪';
  return String.fromCharCodes(value.runes.take(1)).toUpperCase();
}

String providerLabel(List<CatalogProvider> providers, String source) =>
    providers.where((provider) => provider.id == source).firstOrNull?.name ??
    source;

double trackSearchScore(Track track, String normalizedQuery) {
  final query = _normalize(normalizedQuery);
  if (query.isEmpty) return 0;
  final title = _normalize(track.title);
  final artist = _normalize(track.artist);
  if (title == query) return 1000;
  if (title.startsWith(query)) return 800 - (title.length - query.length) / 100;
  if (title.contains(query)) return 600 - title.indexOf(query) / 100;
  if (artist == query) return 400;
  if (artist.contains(query)) return 300 - artist.indexOf(query) / 100;
  return 0;
}

String _normalize(String value) =>
    value.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();

String? _string(Object? value) {
  if (value is! String) return null;
  final result = value.trim();
  return result.isEmpty ? null : result;
}

String _highestQuality(Map<String, Object?> raw) {
  final values = <String>{};
  void collect(Object? value) {
    switch (value) {
      case String value:
        values.add(value.toLowerCase());
      case Iterable<Object?> value:
        for (final item in value) {
          collect(item);
        }
      case Map<Object?, Object?> value:
        for (final entry in value.entries) {
          if (entry.key is String) {
            values.add((entry.key! as String).toLowerCase());
          }
          collect(entry.value);
        }
    }
  }

  collect(raw['types']);
  collect(raw['_types']);
  if (raw['meta'] case final Map<Object?, Object?> meta) {
    collect(meta['qualitys']);
    collect(meta['qualities']);
  }
  for (final quality in const ['flac24bit', 'flac', '320k', '128k']) {
    if (values.contains(quality)) return quality;
  }
  return '128k';
}

String? _durationLabel(Object? value) {
  if (value is num) return _formatSeconds(value.round());
  if (value is! String) return null;
  final normalized = value.trim();
  if (normalized.isEmpty) return null;
  final seconds = int.tryParse(normalized);
  if (seconds != null) return _formatSeconds(seconds);
  final parts = normalized.split(':');
  if (parts.length != 2) return null;
  final minutes = int.tryParse(parts.first);
  final remainder = int.tryParse(parts.last);
  if (minutes == null || remainder == null || remainder > 59) return null;
  return '$minutes:${remainder.toString().padLeft(2, '0')}';
}

String _formatSeconds(int seconds) {
  if (seconds < 0) return '0:00';
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}
