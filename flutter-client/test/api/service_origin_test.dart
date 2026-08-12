import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/service_exception.dart';
import 'package:musicfree_service_client/api/service_origin.dart';

void main() {
  group('ServiceOrigin', () {
    test('normalizes a valid HTTP origin', () {
      final origin = ServiceOrigin.parse(' http://192.168.1.5:23330/ ');

      expect(origin.uri.toString(), 'http://192.168.1.5:23330');
      expect(
        origin.resolve('/api/v1/health').toString(),
        'http://192.168.1.5:23330/api/v1/health',
      );
    });

    test(
      'rejects credentials, path, query, fragment, and unsupported schemes',
      () {
        for (final value in [
          'ftp://server.local',
          'http://user:pass@server.local',
          'http://server.local/base',
          'http://server.local?q=1',
          'http://server.local/#part',
        ]) {
          expect(
            () => ServiceOrigin.parse(value),
            throwsA(isA<ServiceException>()),
            reason: value,
          );
        }
      },
    );

    test('never resolves absolute or protocol-relative targets', () {
      final origin = ServiceOrigin.parse('https://service.local');

      expect(
        () => origin.resolve('https://evil.example/api/v1/health'),
        throwsA(isA<ServiceException>()),
      );
      expect(
        () => origin.resolve('//evil.example/api/v1/health'),
        throwsA(isA<ServiceException>()),
      );
    });
  });
}
