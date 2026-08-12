import '../../api/models.dart';
import '../../api/service_api.dart';

final class MusicSourceProvider {
  const MusicSourceProvider({
    required this.id,
    required this.actions,
    required this.qualities,
  });

  factory MusicSourceProvider.fromJson(String id, Object? value) {
    final json = jsonObject(value, 'source.providers.$id');
    return MusicSourceProvider(
      id: id,
      actions: jsonList(json['actions'], 'source.providers.$id.actions')
          .map((value) => jsonString(value, 'source.provider.action'))
          .toList(growable: false),
      qualities: jsonList(json['qualitys'], 'source.providers.$id.qualitys')
          .map((value) => jsonString(value, 'source.provider.quality'))
          .toList(growable: false),
    );
  }

  final String id;
  final List<String> actions;
  final List<String> qualities;
}

final class InstalledMusicSource {
  const InstalledMusicSource({
    required this.id,
    required this.name,
    required this.description,
    required this.version,
    required this.author,
    required this.homepage,
    required this.active,
    required this.providers,
  });

  factory InstalledMusicSource.fromJson(Object? value) {
    final json = jsonObject(value, 'source');
    final rawProviders = json['sources'];
    final providers = rawProviders == null
        ? const <MusicSourceProvider>[]
        : jsonObject(rawProviders, 'source.providers').entries
              .map(
                (entry) => MusicSourceProvider.fromJson(entry.key, entry.value),
              )
              .toList(growable: false);
    return InstalledMusicSource(
      id: jsonString(json['id'], 'source.id'),
      name: jsonString(json['name'], 'source.name', allowEmpty: true),
      description: jsonString(
        json['description'],
        'source.description',
        allowEmpty: true,
      ),
      version: jsonString(json['version'], 'source.version', allowEmpty: true),
      author: jsonString(json['author'], 'source.author', allowEmpty: true),
      homepage: jsonString(
        json['homepage'],
        'source.homepage',
        allowEmpty: true,
      ),
      active: json['active'] == true,
      providers: providers,
    );
  }

  final String id;
  final String name;
  final String description;
  final String version;
  final String author;
  final String homepage;
  final bool active;
  final List<MusicSourceProvider> providers;
}

final class SourceRepository {
  const SourceRepository(this.api);
  final ServiceApi api;

  Future<List<InstalledMusicSource>> list() async => jsonList(
    await api.request('GET', '/api/v1/sources'),
    'sources',
  ).map(InstalledMusicSource.fromJson).toList(growable: false);

  Future<InstalledMusicSource> activate(String sourceId) async =>
      InstalledMusicSource.fromJson(
        await api.request(
          'PUT',
          '/api/v1/sources/active',
          body: {'sourceId': sourceId},
        ),
      );
}
