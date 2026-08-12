import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_exception.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/features/sources/source_repository.dart';
import 'package:musicfree_service_client/features/sources/sources_controller.dart';

Map<String, Object?> source(String id, {required bool active}) => {
  'id': id,
  'name': '音源 $id',
  'description': '',
  'version': '1.0.0',
  'author': 'Test',
  'homepage': '',
  'active': active,
  'sources': {
    'kw': {
      'type': 'music',
      'actions': ['musicUrl', 'lyric'],
      'qualitys': ['320k', 'flac'],
    },
  },
};

http.Response ok(Object? data) => http.Response(
  jsonEncode({'data': data}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  test('switches only after Service confirmation and sends sourceId', () async {
    Object? activationBody;
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient((request) async {
        if (request.url.path == '/api/v1/sources') {
          return ok([source('a', active: true), source('b', active: false)]);
        }
        activationBody = jsonDecode(request.body);
        return ok(source('b', active: true));
      }),
    );
    final controller = SourcesController(SourceRepository(api));

    await controller.refresh();
    expect(
      controller.state.error,
      isNull,
      reason: (controller.state.error as ServiceException?)?.details.toString(),
    );
    expect(controller.state.active?.id, 'a');
    await controller.activate('b');

    expect(activationBody, {'sourceId': 'b'});
    expect(controller.state.active?.id, 'b');
    expect(
      controller.state.error,
      isNull,
      reason: (controller.state.error as ServiceException?)?.details.toString(),
    );
  });

  test('retains the previous active source when switching fails', () async {
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient((request) async {
        if (request.url.path == '/api/v1/sources') {
          return ok([source('a', active: true), source('b', active: false)]);
        }
        return http.Response(
          jsonEncode({
            'error': {'code': 'SOURCE_INVALID', 'message': 'Cannot activate'},
          }),
          502,
        );
      }),
    );
    final controller = SourcesController(SourceRepository(api));

    await controller.refresh();
    expect(controller.state.error, isNull);
    await controller.activate('b');

    expect(controller.state.active?.id, 'a');
    expect(controller.state.error, isNotNull);
    expect(controller.state.switchingId, isNull);
  });
}
