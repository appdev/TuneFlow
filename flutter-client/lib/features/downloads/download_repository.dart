import '../../api/models.dart';
import '../../api/service_api.dart';

final class DownloadRepository {
  const DownloadRepository(this.api);
  final ServiceApi api;

  Future<List<DownloadJob>> list() async => jsonList(
    await api.request('GET', '/api/v1/downloads'),
    'downloads',
  ).map(DownloadJob.fromJson).toList(growable: false);

  Future<DownloadJob> create(
    Track track,
    String quality, {
    Object? qualityList,
    String? listId,
  }) async {
    final body = <String, Object?>{
      'musicInfo': track.toJson(),
      'quality': quality,
      if (qualityList != null) 'qualityList': qualityList,
      if (listId != null) 'listId': listId,
    };
    return DownloadJob.fromJson(
      await api.request('POST', '/api/v1/downloads', body: body),
    );
  }

  Future<DownloadJob> start(String id) => _action(id, 'start');
  Future<DownloadJob> pause(String id) => _action(id, 'pause');
  Future<DownloadJob> resume(String id) => _action(id, 'resume');
  Future<DownloadJob> _action(String id, String action) async =>
      DownloadJob.fromJson(
        await api.request(
          'POST',
          '/api/v1/downloads/${Uri.encodeComponent(id)}/$action',
        ),
      );
  Future<void> delete(String id) =>
      api.request('DELETE', '/api/v1/downloads/${Uri.encodeComponent(id)}');
}
