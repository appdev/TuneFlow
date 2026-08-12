import 'service_exception.dart';

final class ServiceOrigin {
  ServiceOrigin._(this.uri);

  final Uri uri;

  factory ServiceOrigin.parse(String value) {
    final parsed = Uri.tryParse(value.trim());
    final validScheme = parsed?.scheme == 'http' || parsed?.scheme == 'https';
    final validPath = parsed?.path.isEmpty == true || parsed?.path == '/';
    if (parsed == null ||
        !validScheme ||
        parsed.host.isEmpty ||
        parsed.userInfo.isNotEmpty ||
        !validPath ||
        parsed.hasQuery ||
        parsed.hasFragment) {
      throw const ServiceException(
        'INVALID_SERVICE_ORIGIN',
        'Service address must be an HTTP(S) origin without a path, query, or credentials.',
      );
    }
    return ServiceOrigin._(parsed.replace(path: ''));
  }

  Uri resolve(String path) {
    final target = Uri.tryParse(path);
    if (target == null ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        target.hasScheme ||
        target.hasAuthority ||
        target.hasFragment) {
      throw const ServiceException(
        'INVALID_SERVICE_PATH',
        'Service request paths must be same-origin absolute paths.',
      );
    }
    return uri.replace(
      path: target.path,
      query: target.hasQuery ? target.query : null,
    );
  }
}
