final class ServiceException implements Exception {
  const ServiceException(this.code, this.message, {this.status, this.details});

  final String code;
  final String message;
  final int? status;
  final Object? details;

  @override
  String toString() => status == null
      ? 'ServiceException($code): $message'
      : 'ServiceException($status, $code): $message';
}
