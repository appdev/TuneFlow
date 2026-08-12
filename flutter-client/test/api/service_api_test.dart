import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_exception.dart';
import 'package:musicfree_service_client/api/service_origin.dart';

void main() {
  test('decodes the success envelope and sends JSON', () async {
    final client = MockClient((request) async {
      expect(request.url.toString(), 'http://service.local/api/v1/test');
      expect(request.method, 'POST');
      expect(request.headers['content-type'], contains('application/json'));
      expect(jsonDecode(request.body), {'value': 1});
      return http.Response(
        jsonEncode({
          'data': {'ok': true},
        }),
        201,
      );
    });
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: client,
    );

    expect(await api.request('POST', '/api/v1/test', body: {'value': 1}), {
      'ok': true,
    });
  });

  test('maps the service error envelope', () async {
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 'SOURCE_UNAVAILABLE',
              'message': 'No source',
              'details': {'source': 'kw'},
            },
          }),
          503,
        ),
      ),
    );

    await expectLater(
      api.request('GET', '/api/v1/test'),
      throwsA(
        isA<ServiceException>()
            .having((e) => e.code, 'code', 'SOURCE_UNAVAILABLE')
            .having((e) => e.status, 'status', 503),
      ),
    );
  });

  test('rejects redirects and malformed success envelopes', () async {
    var response = http.Response(
      '',
      302,
      headers: {'location': 'https://evil.example'},
    );
    final api = ServiceApi(
      ServiceOrigin.parse('http://service.local'),
      client: MockClient((_) async => response),
    );

    await expectLater(
      api.request('GET', '/api/v1/test'),
      throwsA(
        isA<ServiceException>().having(
          (e) => e.code,
          'code',
          'REDIRECT_REJECTED',
        ),
      ),
    );

    response = http.Response(jsonEncode({'ok': true}), 200);
    await expectLater(
      api.request('GET', '/api/v1/test'),
      throwsA(
        isA<ServiceException>().having(
          (e) => e.code,
          'code',
          'INVALID_RESPONSE',
        ),
      ),
    );
  });
}
