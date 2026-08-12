import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/downloads/downloads_controller.dart';

Map<String, Object?> job(String status, {String id = 'one'}) => {
  'id': id,
  'status': status,
  'musicInfo': {'id': 'track', 'name': 'Track'},
  'quality': '128k',
  'extension': 'mp3',
  'fileName': 'track.mp3',
  'downloaded': 0,
  'total': 10,
  'progress': 0,
  'queuePosition': 1,
  'createdAt': 1000,
  'updatedAt': 1000,
};

http.Response data(Object? value, [int status = 200]) =>
    http.Response(jsonEncode({'data': value}), status);

void main() {
  test('every mutation finishes with an authoritative list refresh', () async {
    final calls = <String>[];
    final repository = DownloadRepository(
      ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient((request) async {
          calls.add('${request.method} ${request.url.path}');
          if (request.method == 'GET') return data([job('completed')]);
          if (request.method == 'DELETE') return data(null, 204);
          return data(job('running'));
        }),
      ),
    );
    final controller = DownloadsController(repository);

    await controller.start('one');
    await controller.pause('one');
    await controller.resume('one');
    await controller.delete('one');

    expect(calls.where((call) => call == 'GET /api/v1/downloads').length, 4);
    expect(controller.state.jobs.single.status.name, 'completed');
  });

  test('failed refresh retains previous jobs as stale', () async {
    var fail = false;
    final controller = DownloadsController(
      DownloadRepository(
        ServiceApi(
          ServiceOrigin.parse('http://service.local'),
          client: MockClient((_) async {
            if (fail) throw StateError('offline');
            return data([job('waiting')]);
          }),
        ),
      ),
    );
    await controller.refresh();
    fail = true;
    await controller.refresh();

    expect(controller.state.jobs.single.id, 'one');
    expect(controller.state.stale, isTrue);
  });

  test('pause all retains successes and reports individual failures', () async {
    var pausedA = false;
    final controller = DownloadsController(
      DownloadRepository(
        ServiceApi(
          ServiceOrigin.parse('http://service.local'),
          client: MockClient((request) async {
            if (request.method == 'GET') {
              return data([
                job(pausedA ? 'paused' : 'running', id: 'a'),
                job('running', id: 'b'),
              ]);
            }
            if (request.url.path.contains('/a/')) {
              pausedA = true;
              return data(job('paused', id: 'a'));
            }
            return http.Response(
              jsonEncode({
                'error': {'code': 'PAUSE_FAILED', 'message': 'Cannot pause'},
              }),
              500,
            );
          }),
        ),
      ),
    );
    await controller.refresh();

    final result = await controller.pauseAll();

    expect(result.succeededIds, ['a']);
    expect(result.failures.keys, ['b']);
    expect(
      controller.state.jobs.singleWhere((job) => job.id == 'a').status,
      DownloadStatus.paused,
    );
  });
}
