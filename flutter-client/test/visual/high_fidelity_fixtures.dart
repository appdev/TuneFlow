import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/downloads/downloads_controller.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:musicfree_service_client/features/home/home_controller.dart';
import 'package:musicfree_service_client/features/library/library_repository.dart';
import 'package:musicfree_service_client/features/player/playback_repository.dart';
import 'package:musicfree_service_client/features/player/player_controller.dart';
import 'package:musicfree_service_client/features/player/player_state.dart';
import 'package:musicfree_service_client/features/player/service_audio_handler.dart';
import 'package:musicfree_service_client/features/player/wake_lock_port.dart';
import 'package:musicfree_service_client/features/playlists/playlist_repository.dart';
import 'package:musicfree_service_client/features/playlists/playlist_detail_controller.dart';
import 'package:musicfree_service_client/features/playlists/playlists_controller.dart';
import 'package:musicfree_service_client/features/search/search_controller.dart'
    as feature;
import 'package:musicfree_service_client/features/search/search_repository.dart';
import 'package:musicfree_service_client/features/settings/settings_controller.dart';
import 'package:musicfree_service_client/features/sources/source_repository.dart';
import 'package:musicfree_service_client/features/sources/sources_controller.dart';
import 'package:musicfree_service_client/l10n/app_localizations.dart';
import 'package:musicfree_service_client/storage/app_preferences.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget visualHarness(Widget child, {required ThemeMode themeMode}) =>
    ShadApp.custom(
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: themeMode,
      appBuilder: (context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: Theme.of(context),
        locale: const Locale('zh'),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: ShadAppBuilder(child: child)),
      ),
    );

ServiceApi fixtureApi() => ServiceApi(
  ServiceOrigin.parse('http://service.local'),
  client: MockClient((request) async {
    final path = request.url.path;
    Object? value;
    if (path == '/api/v1/playlists') {
      value = [
        {'id': 'wind', 'name': '晚风', 'source': '伍佰 · 12 首'},
        {'id': 'island', 'name': '岛屿来信', 'source': '晚间精选 · 19 首'},
        {'id': 'city', 'name': '城市霓虹', 'source': '独立流行 · 26 首'},
        {'id': 'romance', 'name': '浪人情歌', 'source': '现场回响 · 33 首'},
      ];
    } else if (path == '/api/v1/playlists/wind') {
      value = {
        'id': 'wind',
        'name': '风从台北来',
        'tracks': [
          fixtureTrack('wind', '晚风', '伍佰 & China Blue'),
          fixtureTrack('forest', '挪威的森林', '伍佰 & China Blue'),
          fixtureTrack('romance', '浪人情歌', '伍佰'),
          fixtureTrack('white', '白鸽', '伍佰'),
          fixtureTrack('sudden', '突然的自我', '伍佰'),
        ],
      };
    } else if (path.startsWith('/api/v1/playlists/')) {
      final id = path.split('/').last;
      final names = {'island': '岛屿来信', 'city': '城市霓虹', 'romance': '浪人情歌'};
      value = {
        'id': id,
        'name': names[id] ?? id,
        'tracks': [
          fixtureTrack('${id}_1', names[id] ?? id, 'Service Artist'),
          fixtureTrack('${id}_2', '夜色回声', 'Service Artist'),
          fixtureTrack('${id}_3', '远方来信', 'Service Artist'),
        ],
      };
    } else if (path == '/api/v1/downloads') {
      value = [
        fixtureJob('running', id: 'wind', progress: 62),
        fixtureJob('waiting', id: 'forest', queuePosition: 1),
        fixtureJob('paused', id: 'romance', progress: 38),
        fixtureJob('error', id: 'white'),
        fixtureJob('completed', id: 'sudden', progress: 100),
      ];
    } else if (path == '/api/v1/library/tracks') {
      value = [
        for (final item in [
          ('wind', '晚风', '伍佰 & China Blue'),
          ('forest', '挪威的森林', '伍佰 & China Blue'),
          ('romance', '浪人情歌', '伍佰'),
          ('white', '白鸽', '伍佰'),
        ])
          {
            'id': item.$1,
            'musicInfo': fixtureTrack(item.$1, item.$2, item.$3),
            'size': 7340032,
            'extension': 'flac',
            'streamUrl': '/api/v1/library/tracks/${item.$1}/stream',
          },
      ];
    } else if (path == '/api/v1/sources') {
      value = [
        {
          'id': 'exclusive',
          'name': '夜航音源',
          'description': 'v1.4.2 · 当前启用',
          'version': '1.4.2',
          'author': 'TuneFlow',
          'homepage': '',
          'active': true,
          'sources': {
            'kw': {
              'actions': ['musicUrl'],
              'qualitys': ['128k', '320k'],
            },
            'kg': {
              'actions': ['musicUrl'],
              'qualitys': ['128k'],
            },
            'tx': {
              'actions': ['musicUrl'],
              'qualitys': ['128k'],
            },
          },
        },
        {
          'id': 'echo',
          'name': '回声源',
          'description': 'v0.9.8 · 已安装',
          'version': '0.9.8',
          'author': 'Community',
          'homepage': '',
          'active': false,
          'sources': {
            'wy': {
              'actions': ['musicUrl'],
              'qualitys': ['128k', 'flac'],
            },
            'mg': {
              'actions': ['musicUrl'],
              'qualitys': ['128k'],
            },
          },
        },
      ];
    } else if (path.endsWith('/catalog/capabilities')) {
      value = {
        'sources': [
          {
            'id': 'kw',
            'name': '酷我音乐',
            'searchKinds': ['track', 'playlist'],
            'leaderboards': true,
          },
          {
            'id': 'kg',
            'name': '酷狗音乐',
            'searchKinds': ['track', 'playlist'],
            'leaderboards': true,
          },
          {
            'id': 'tx',
            'name': 'QQ音乐',
            'searchKinds': ['track', 'playlist'],
            'leaderboards': true,
          },
          {
            'id': 'wy',
            'name': '网易音乐',
            'searchKinds': ['track', 'playlist', 'album'],
            'leaderboards': true,
          },
          {
            'id': 'mg',
            'name': '咪咕音乐',
            'searchKinds': ['track'],
          },
        ],
      };
    } else if (path.endsWith('/leaderboards')) {
      value = {
        'list': [
          {'id': 'kw__93', 'providerId': '93', 'name': '飙升榜', 'source': 'kw'},
          {'id': 'kw__16', 'providerId': '16', 'name': '热歌榜', 'source': 'kw'},
          {'id': 'kw__17', 'providerId': '17', 'name': '新歌榜', 'source': 'kw'},
        ],
        'source': 'kw',
      };
    } else if (path.endsWith('/leaderboards/tracks')) {
      value = {
        'list': [
          fixtureTrack('wind', '晚风', '伍佰 & China Blue'),
          fixtureTrack('forest', '挪威的森林', '伍佰 & China Blue'),
          fixtureTrack('romance', '浪人情歌', '伍佰'),
        ],
        'total': 3,
        'page': 1,
        'limit': 30,
        'source': 'kw',
      };
    } else if (path.endsWith('/playlists/search')) {
      value = {
        'list': [
          {
            'id': 'wind',
            'kind': 'playlist',
            'name': '晚风',
            'source': 'kw',
            'author': '伍佰',
            'total': 12,
          },
          {
            'id': 'island',
            'kind': 'playlist',
            'name': '岛屿来信',
            'source': 'kw',
            'author': '晚间精选',
            'total': 19,
          },
          {
            'id': 'city',
            'kind': 'playlist',
            'name': '城市霓虹',
            'source': 'kw',
            'author': '独立流行',
            'total': 26,
          },
          {
            'id': 'romance',
            'kind': 'playlist',
            'name': '浪人情歌',
            'source': 'kw',
            'author': '现场回响',
            'total': 33,
          },
        ],
        'total': 4,
      };
    } else if (path.endsWith('/tracks/search')) {
      value = {
        'list': [
          for (final item in [
            ('wind', '晚风', '伍佰 & China Blue'),
            ('forest', '挪威的森林', '伍佰 & China Blue'),
            ('romance', '浪人情歌', '伍佰'),
            ('white', '白鸽', '伍佰'),
            ('sudden', '突然的自我', '伍佰'),
          ])
            {
              ...fixtureTrack(item.$1, item.$2, item.$3),
              'albumName': item.$1 == 'wind' ? '晚风精选' : '伍佰经典作品集',
              'interval': item.$1 == 'wind' ? 225 : 253,
              'types': item.$1 == 'wind' ? ['128k', 'flac'] : ['128k', '320k'],
            },
        ],
        'total': 3,
      };
    } else {
      value = <Object?>[];
    }
    return http.Response(
      jsonEncode({'data': value}),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  }),
);

Map<String, Object?> fixtureTrack(String id, String name, String artist) => {
  'id': id,
  'name': name,
  'singer': artist,
  'source': 'kw',
};

Map<String, Object?> fixtureJob(
  String status, {
  required String id,
  double progress = 0,
  int? queuePosition,
}) => {
  'id': id,
  'status': status,
  'musicInfo': switch (id) {
    'wind' => fixtureTrack(id, '晚风', '伍佰 & China Blue'),
    'forest' => fixtureTrack(id, '挪威的森林', '伍佰 & China Blue'),
    'romance' => fixtureTrack(id, '浪人情歌', '伍佰'),
    'white' => fixtureTrack(id, '白鸽', '伍佰'),
    'sudden' => fixtureTrack(id, '突然的自我', '伍佰'),
    _ => fixtureTrack(id, '曲目 $id', 'Service Artist'),
  },
  'quality': switch (id) {
    'wind' || 'forest' || 'white' => 'flac',
    _ => '320k',
  },
  'extension': switch (id) {
    'wind' || 'forest' || 'white' => 'flac',
    _ => 'mp3',
  },
  'fileName':
      '$id.${id == 'wind' || id == 'forest' || id == 'white' ? 'flac' : 'mp3'}',
  'downloaded': progress * 1024,
  'total': 102400,
  'progress': progress,
  'queuePosition': queuePosition,
  'createdAt': 1000,
  'updatedAt': 2000,
};

Future<HomeController> fixtureHomeController() async {
  final api = fixtureApi();
  final controller = HomeController(
    playlists: PlaylistRepository(api),
    downloads: DownloadRepository(api),
    library: LibraryRepository(api),
  );
  await controller.refresh();
  return controller;
}

Future<feature.SearchController> fixtureSearchController() async {
  final controller = feature.SearchController(SearchRepository(fixtureApi()));
  await controller.loadCapabilities();
  await controller.search(source: 'kw', query: '伍佰');
  return controller;
}

Future<DownloadsController> fixtureDownloadsController() async {
  final controller = DownloadsController(DownloadRepository(fixtureApi()));
  await controller.refresh();
  return controller;
}

Future<PlaylistsController> fixturePlaylistsController() async {
  final controller = PlaylistsController(PlaylistRepository(fixtureApi()));
  await controller.refresh();
  return controller;
}

PlaylistDetailController fixturePlaylistDetailController() =>
    PlaylistDetailController(PlaylistRepository(fixtureApi()), 'wind');

SettingsController fixtureSettingsController() => SettingsController(
  settings: const AppSettings(
    origin: 'http://192.168.1.24:23330',
    themeMode: ThemeMode.dark,
    quality: PlaybackQuality.lossless,
    showLyrics: true,
    showTranslation: true,
  ),
  save: (_) async {},
  connect: (_) async {},
  disconnect: () async {},
  setPlayerQuality: (_) async {},
  diagnostics: (origin) async => ConnectionDiagnostics(
    origin: origin,
    connected: true,
    latency: const Duration(milliseconds: 18),
    apiVersion: 'v1',
    checkedAt: DateTime(2026),
  ),
);

SourcesController fixtureSourcesController() =>
    SourcesController(SourceRepository(fixtureApi()));

final class FixtureResolver implements PlaybackResolver {
  @override
  Future<PlaybackSource> resolve(Track track, String quality) async =>
      PlaybackSource(
        resolved: const ResolvedTrack(
          url: '/stream',
          quality: 'flac',
          expiresAt: 1,
        ),
        streamUri: Uri.parse('http://service.local/stream'),
      );
}

final class FixtureAudio implements AudioPort {
  @override
  Stream<AudioSnapshot> get snapshots => Stream.value(
    const AudioSnapshot(
      playing: false,
      processing: PlayerProcessing.ready,
      position: Duration(seconds: 96),
      duration: Duration(minutes: 3, seconds: 48),
      buffered: Duration(minutes: 2),
    ),
  );

  @override
  void bindQueueCallbacks({
    required Future<void> Function() previous,
    required Future<void> Function() next,
  }) {}

  @override
  Future<void> pause() async {}
  @override
  Future<bool> playCachedTrack(Track track, String quality) async => true;
  @override
  Future<void> playTrack(Track track, Uri streamUri, String quality) async {}
  @override
  Future<void> resume() async {}
  @override
  Future<void> seek(Duration position) async {}
}

Future<PlayerController> fixturePlayerController() async {
  final controller = PlayerController(
    resolver: FixtureResolver(),
    audio: FixtureAudio(),
    quality: 'flac',
  );
  await controller.playTracks([
    Track.fromJson(fixtureTrack('wind', '晚风', '伍佰 & China Blue')),
    Track.fromJson(fixtureTrack('forest', '挪威的森林', '伍佰 & China Blue')),
    Track.fromJson(fixtureTrack('romance', '浪人情歌', '伍佰')),
    Track.fromJson(fixtureTrack('white', '白鸽', '伍佰')),
    Track.fromJson(fixtureTrack('sudden', '突然的自我', '伍佰')),
  ]);
  controller.setView(PlayerView.artwork);
  return controller;
}

final class NoopWakeLock implements WakeLockPort {
  @override
  Future<void> setEnabled(bool value) async {}
}
