import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/search/search_track_metadata.dart';

Track track(Map<String, Object?> value) => Track.fromJson({
  'id': 'one',
  'name': '晴天',
  'singer': '周杰伦',
  'source': 'tx',
  ...value,
});

void main() {
  test('selects highest quality across supported metadata shapes', () {
    expect(
      SearchTrackMetadata.fromTrack(
        track({
          'types': ['128k', '320k', 'flac', 'flac24bit'],
        }),
      ).qualityLabel,
      'Hi-Res',
    );
    expect(
      SearchTrackMetadata.fromTrack(
        track({
          '_types': {'128k': {}, 'flac': {}},
        }),
      ).qualityLabel,
      '无损',
    );
    expect(
      SearchTrackMetadata.fromTrack(
        track({
          'meta': {
            'qualitys': ['128k', '320k'],
          },
        }),
      ).qualityLabel,
      '320K',
    );
  });

  test('hides 128k-only quality while retaining download key', () {
    final metadata = SearchTrackMetadata.fromTrack(
      track({
        'meta': {
          'qualitys': ['128k'],
        },
      }),
    );
    expect(metadata.qualityKey, '128k');
    expect(metadata.qualityLabel, isNull);
  });

  test('extracts album and formats duration', () {
    final numeric = SearchTrackMetadata.fromTrack(
      track({'albumName': '叶惠美', 'interval': 253}),
    );
    expect(numeric.album, '叶惠美');
    expect(numeric.durationLabel, '4:13');

    final string = SearchTrackMetadata.fromTrack(
      track({'album': '专辑', 'interval': '04:05'}),
    );
    expect(string.album, '专辑');
    expect(string.durationLabel, '4:05');
  });

  test('provides safe initial, provider label, and deterministic score', () {
    expect(trackInitial(track({'name': '  晴天'})), '晴');
    expect(trackInitial(track({'name': '', 'id': 'fallback'})), 'F');
    expect(
      providerLabel(const [
        CatalogProvider(
          id: 'tx',
          name: '企鹅音乐',
          searchKinds: {CatalogSearchKind.track},
        ),
      ], 'tx'),
      '企鹅音乐',
    );
    expect(trackSearchScore(track({}), '晴天'), greaterThan(900));
    expect(trackSearchScore(track({}), '周杰伦'), greaterThan(100));
  });
}
