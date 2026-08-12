import 'service_exception.dart';

Never _invalid(String field) => throw ServiceException(
  'INVALID_RESPONSE',
  'Service response contains an invalid $field field.',
  details: {'field': field},
);

Map<String, Object?> jsonObject(Object? value, [String field = 'object']) {
  if (value is! Map) _invalid(field);
  try {
    return Map<String, Object?>.from(value);
  } on Object {
    _invalid(field);
  }
}

List<Object?> jsonList(Object? value, String field) {
  if (value is! List) _invalid(field);
  return List<Object?>.from(value);
}

String jsonString(Object? value, String field, {bool allowEmpty = false}) {
  if (value is! String || (!allowEmpty && value.isEmpty)) _invalid(field);
  return value;
}

int jsonInt(Object? value, String field) {
  if (value is! int) _invalid(field);
  return value;
}

final class Capabilities {
  const Capabilities({
    required this.runtime,
    required this.apiVersion,
    required this.features,
  });

  factory Capabilities.fromJson(Object? value) {
    final json = jsonObject(value, 'capabilities');
    return Capabilities(
      runtime: jsonString(json['runtime'], 'runtime'),
      apiVersion: jsonString(json['apiVersion'], 'apiVersion'),
      features: jsonObject(json['features'], 'features'),
    );
  }

  final String runtime;
  final String apiVersion;
  final Map<String, Object?> features;
}

final class Track {
  Track._({
    required this.id,
    required this.title,
    required this.artist,
    required this.source,
    required this.raw,
  });

  factory Track.fromJson(Object? value) {
    final json = jsonObject(value, 'track');
    final id = jsonString(json['id'] ?? json['songmid'], 'track.id');
    final meta = json['meta'];
    final picture = json['pic'] is String
        ? json['pic']
        : json['img'] is String
        ? json['img']
        : meta is Map && meta['picUrl'] is String
        ? meta['picUrl']
        : null;
    return Track._(
      id: id,
      title: json['name'] is String ? json['name']! as String : '',
      artist: json['singer'] is String ? json['singer']! as String : '',
      source: json['source'] is String ? json['source']! as String : '',
      raw: Map.unmodifiable({
        ...json,
        'id': id,
        if (picture != null) 'pic': picture,
      }),
    );
  }

  final String id;
  final String title;
  final String artist;
  final String source;
  final Map<String, Object?> raw;

  Map<String, Object?> toJson() => Map<String, Object?>.from(raw);
}

final class SearchPage {
  const SearchPage({required this.tracks, required this.total});

  factory SearchPage.fromJson(Object? value) {
    if (value is List) {
      return SearchPage(
        tracks: value.map(Track.fromJson).toList(growable: false),
        total: null,
      );
    }
    final json = jsonObject(value, 'searchPage');
    final total = json['total'];
    if (total != null && total is! int) _invalid('searchPage.total');
    return SearchPage(
      tracks: jsonList(
        json['list'],
        'searchPage.list',
      ).map(Track.fromJson).toList(growable: false),
      total: total as int?,
    );
  }

  final List<Track> tracks;
  final int? total;
}

enum CatalogSearchKind { track, playlist, album }

final class CatalogProvider {
  const CatalogProvider({
    required this.id,
    required this.name,
    required this.searchKinds,
    this.leaderboards = false,
  });

  factory CatalogProvider.fromJson(Object? value) {
    final json = jsonObject(value, 'catalogProvider');
    return CatalogProvider(
      id: jsonString(json['id'], 'catalogProvider.id'),
      name: jsonString(json['name'], 'catalogProvider.name'),
      searchKinds: jsonList(json['searchKinds'], 'catalogProvider.searchKinds')
          .map(
            (value) => CatalogSearchKind.values
                .where((kind) => kind.name == value)
                .firstOrNull,
          )
          .whereType<CatalogSearchKind>()
          .toSet(),
      leaderboards: json['leaderboards'] == true,
    );
  }

  final String id;
  final String name;
  final Set<CatalogSearchKind> searchKinds;
  final bool leaderboards;
}

final class Leaderboard {
  const Leaderboard({
    required this.id,
    required this.providerId,
    required this.name,
    required this.source,
  });

  factory Leaderboard.fromJson(Object? value) {
    final json = jsonObject(value, 'leaderboard');
    return Leaderboard(
      id: jsonString(json['id'], 'leaderboard.id'),
      providerId: jsonString(
        json['providerId'] ?? json['bangid'],
        'leaderboard.providerId',
      ),
      name: jsonString(json['name'], 'leaderboard.name'),
      source: json['source'] is String ? json['source']! as String : '',
    );
  }

  final String id;
  final String providerId;
  final String name;
  final String source;
}

final class LeaderboardPage {
  const LeaderboardPage({required this.items, required this.source});

  factory LeaderboardPage.fromJson(Object? value) {
    final json = jsonObject(value, 'leaderboardPage');
    final source = jsonString(json['source'], 'leaderboardPage.source');
    return LeaderboardPage(
      items: jsonList(json['list'], 'leaderboardPage.list')
          .map((item) {
            final board = Leaderboard.fromJson(item);
            return board.source.isEmpty
                ? Leaderboard(
                    id: board.id,
                    providerId: board.providerId,
                    name: board.name,
                    source: source,
                  )
                : board;
          })
          .toList(growable: false),
      source: source,
    );
  }

  final List<Leaderboard> items;
  final String source;
}

final class LeaderboardTrackPage {
  const LeaderboardTrackPage({required this.tracks, required this.total});

  factory LeaderboardTrackPage.fromJson(Object? value) {
    final page = SearchPage.fromJson(value);
    return LeaderboardTrackPage(tracks: page.tracks, total: page.total);
  }

  final List<Track> tracks;
  final int? total;
}

final class CatalogCapabilities {
  const CatalogCapabilities({required this.providers});

  factory CatalogCapabilities.fromJson(Object? value) {
    final json = jsonObject(value, 'catalogCapabilities');
    return CatalogCapabilities(
      providers: jsonList(
        json['sources'],
        'catalogCapabilities.sources',
      ).map(CatalogProvider.fromJson).toList(growable: false),
    );
  }

  final List<CatalogProvider> providers;
}

final class CatalogCollection {
  const CatalogCollection({
    required this.id,
    required this.kind,
    required this.name,
    required this.source,
    this.author = '',
    this.total,
    this.imageUrl,
    this.description,
  });

  factory CatalogCollection.fromJson(Object? value) {
    final json = jsonObject(value, 'catalogCollection');
    final kindName = jsonString(json['kind'], 'catalogCollection.kind');
    final kind = CatalogSearchKind.values
        .where((kind) => kind.name == kindName)
        .firstOrNull;
    if (kind == null || kind == CatalogSearchKind.track) {
      _invalid('catalogCollection.kind');
    }
    final total = json['total'];
    if (total != null && total is! num) _invalid('catalogCollection.total');
    return CatalogCollection(
      id: jsonString(json['id'], 'catalogCollection.id'),
      kind: kind,
      name: jsonString(
        json['name'],
        'catalogCollection.name',
        allowEmpty: true,
      ),
      source: jsonString(json['source'], 'catalogCollection.source'),
      author: json['author'] is String ? json['author']! as String : '',
      total: total as num?,
      imageUrl: json['img'] is String
          ? Uri.tryParse(json['img']! as String)
          : null,
      description: json['description'] as String?,
    );
  }

  final String id;
  final CatalogSearchKind kind;
  final String name;
  final String source;
  final String author;
  final num? total;
  final Uri? imageUrl;
  final String? description;
}

final class CollectionSearchPage {
  const CollectionSearchPage({required this.items, required this.total});

  factory CollectionSearchPage.fromJson(Object? value) {
    final json = jsonObject(value, 'collectionSearchPage');
    final total = json['total'];
    if (total != null && total is! num) _invalid('collectionSearchPage.total');
    return CollectionSearchPage(
      items: jsonList(
        json['list'],
        'collectionSearchPage.list',
      ).map(CatalogCollection.fromJson).toList(growable: false),
      total: (total as num?)?.toInt(),
    );
  }

  final List<CatalogCollection> items;
  final int? total;
}

final class Lyrics {
  const Lyrics({required this.original, this.translation});

  factory Lyrics.fromJson(Object? value) {
    final json = jsonObject(value, 'lyrics');
    final translation = json['tlyric'];
    if (translation != null && translation is! String) {
      _invalid('lyrics.tlyric');
    }
    return Lyrics(
      original: jsonString(json['lyric'], 'lyrics.lyric', allowEmpty: true),
      translation: translation as String?,
    );
  }

  final String original;
  final String? translation;
}

class PlaylistSummary {
  const PlaylistSummary({
    required this.id,
    required this.name,
    this.source,
    this.sourceListId,
    this.locationUpdateTime,
  });

  factory PlaylistSummary.fromJson(Object? value) {
    final json = jsonObject(value, 'playlist');
    final updateTime = json['locationUpdateTime'];
    if (updateTime != null && updateTime is! num) {
      _invalid('playlist.locationUpdateTime');
    }
    return PlaylistSummary(
      id: jsonString(json['id'], 'playlist.id'),
      name: jsonString(json['name'], 'playlist.name'),
      source: json['source'] as String?,
      sourceListId: json['sourceListId'] as String?,
      locationUpdateTime: updateTime as num?,
    );
  }

  final String id;
  final String name;
  final String? source;
  final String? sourceListId;
  final num? locationUpdateTime;

  bool get isBuiltIn => id == 'default' || id == 'love';

  String get displayName => switch (id) {
    'default' => '试听列表',
    'love' => '我的收藏',
    _ => name,
  };
}

final class PlaylistDetail extends PlaylistSummary {
  const PlaylistDetail({
    required super.id,
    required super.name,
    super.source,
    super.sourceListId,
    super.locationUpdateTime,
    required this.tracks,
  });

  factory PlaylistDetail.fromJson(Object? value) {
    final json = jsonObject(value, 'playlist');
    final summary = PlaylistSummary.fromJson(json);
    return PlaylistDetail(
      id: summary.id,
      name: summary.name,
      source: summary.source,
      sourceListId: summary.sourceListId,
      locationUpdateTime: summary.locationUpdateTime,
      tracks: jsonList(
        json['tracks'],
        'playlist.tracks',
      ).map(Track.fromJson).toList(growable: false),
    );
  }

  final List<Track> tracks;
}

final class ResolvedTrack {
  const ResolvedTrack({
    required this.url,
    required this.quality,
    required this.expiresAt,
  });

  factory ResolvedTrack.fromJson(Object? value) {
    final json = jsonObject(value, 'resolvedTrack');
    final expiresAt = json['expiresAt'];
    if (expiresAt is! num) _invalid('resolvedTrack.expiresAt');
    return ResolvedTrack(
      url: jsonString(json['url'], 'resolvedTrack.url'),
      quality: jsonString(json['quality'], 'resolvedTrack.quality'),
      expiresAt: expiresAt,
    );
  }

  final String url;
  final String quality;
  final num expiresAt;
}

final class DomainEvent {
  const DomainEvent({
    required this.type,
    required this.data,
    required this.sequence,
  });

  factory DomainEvent.fromJson(Object? value) {
    final json = jsonObject(value, 'event');
    if (!json.containsKey('data')) _invalid('event.data');
    return DomainEvent(
      type: jsonString(json['type'], 'event.type'),
      data: json['data'],
      sequence: jsonInt(json['sequence'], 'event.sequence'),
    );
  }

  final String type;
  final Object? data;
  final int sequence;
}

final class EventSnapshot {
  const EventSnapshot({required this.sequence, required this.events});

  factory EventSnapshot.fromJson(Object? value) {
    final json = jsonObject(value, 'eventSnapshot');
    return EventSnapshot(
      sequence: jsonInt(json['sequence'], 'eventSnapshot.sequence'),
      events: jsonList(
        json['events'],
        'eventSnapshot.events',
      ).map(DomainEvent.fromJson).toList(growable: false),
    );
  }

  final int sequence;
  final List<DomainEvent> events;
}

enum DownloadStatus { waiting, running, paused, error, completed }

final class DownloadJob {
  DownloadJob._({
    required this.raw,
    required this.status,
    required this.musicInfo,
    required this.quality,
    required this.extension,
    required this.fileName,
    required this.downloaded,
    required this.total,
    required this.progress,
    required this.queuePosition,
    required this.createdAt,
    required this.updatedAt,
    required this.warning,
    required this.error,
  });

  factory DownloadJob.fromJson(Object? value) {
    final json = jsonObject(value, 'download');
    jsonString(json['id'], 'download.id');
    final statusName = jsonString(json['status'], 'download.status');
    final status = DownloadStatus.values
        .where((value) => value.name == statusName)
        .firstOrNull;
    if (status == null) _invalid('download.status');
    final downloaded = json['downloaded'];
    final total = json['total'];
    final progress = json['progress'];
    final queuePosition = json['queuePosition'];
    final createdAt = json['createdAt'];
    final updatedAt = json['updatedAt'];
    if (downloaded is! num) _invalid('download.downloaded');
    if (total is! num) _invalid('download.total');
    if (progress is! num || progress < 0 || progress > 100) {
      _invalid('download.progress');
    }
    if (queuePosition != null && queuePosition is! int) {
      _invalid('download.queuePosition');
    }
    if (createdAt != null && createdAt is! num) {
      _invalid('download.createdAt');
    }
    if (updatedAt != null && updatedAt is! num) {
      _invalid('download.updatedAt');
    }
    final createdAtMs = (createdAt as num?)?.toInt() ?? 0;
    final updatedAtMs = (updatedAt as num?)?.toInt() ?? createdAtMs;
    final warning = json['warning'];
    final error = json['error'];
    if (warning != null && warning is! String) _invalid('download.warning');
    if (error != null && error is! String) _invalid('download.error');
    return DownloadJob._(
      raw: Map.unmodifiable(json),
      status: status,
      musicInfo: Track.fromJson(json['musicInfo']),
      quality: jsonString(json['quality'], 'download.quality'),
      extension: jsonString(json['extension'], 'download.extension'),
      fileName: jsonString(json['fileName'], 'download.fileName'),
      downloaded: downloaded,
      total: total,
      progress: progress.toDouble() / 100,
      queuePosition: queuePosition as int?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(createdAtMs),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(updatedAtMs),
      warning: warning as String?,
      error: error as String?,
    );
  }

  final Map<String, Object?> raw;
  String get id => raw['id']! as String;
  final DownloadStatus status;
  final Track musicInfo;
  final String quality;
  final String extension;
  final String fileName;
  final num downloaded;
  final num total;
  final double progress;
  final int? queuePosition;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? warning;
  final String? error;

  bool get canStart =>
      status == DownloadStatus.waiting || status == DownloadStatus.error;
  bool get canPause => status == DownloadStatus.running;
  bool get canResume => status == DownloadStatus.paused;
  bool get canDelete => true;
}

final class LibraryTrack {
  const LibraryTrack({
    required this.id,
    required this.track,
    required this.size,
    required this.extension,
    required this.streamPath,
    this.codec,
  });

  factory LibraryTrack.fromJson(Object? value) {
    final json = jsonObject(value, 'libraryTrack');
    final size = json['size'];
    if (size is! num || size < 0) _invalid('libraryTrack.size');
    return LibraryTrack(
      id: jsonString(json['id'], 'libraryTrack.id'),
      track: Track.fromJson(json['musicInfo']),
      size: size,
      extension: jsonString(json['extension'], 'libraryTrack.extension'),
      codec: json['codec'] as String?,
      streamPath: jsonString(json['streamUrl'], 'libraryTrack.streamUrl'),
    );
  }

  final String id;
  final Track track;
  final num size;
  final String extension;
  final String? codec;
  final String streamPath;
}
