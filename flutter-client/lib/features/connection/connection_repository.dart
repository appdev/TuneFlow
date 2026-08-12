import '../../api/models.dart';
import '../../api/service_api.dart';
import '../../api/service_exception.dart';
import '../../api/service_origin.dart';

typedef ServiceApiFactory = ServiceApi Function(ServiceOrigin origin);

final class ConnectedService {
  const ConnectedService({
    required this.origin,
    required this.api,
    required this.capabilities,
  });
  final ServiceOrigin origin;
  final ServiceApi api;
  final Capabilities capabilities;
}

final class ConnectionDiagnostics {
  const ConnectionDiagnostics({
    required this.origin,
    required this.connected,
    required this.latency,
    required this.apiVersion,
    required this.checkedAt,
  });

  final String origin;
  final bool connected;
  final Duration latency;
  final String apiVersion;
  final DateTime checkedAt;
}

final class ConnectionRepository {
  ConnectionRepository([
    ServiceApiFactory? apiFactory,
    Duration? connectionTimeout,
  ]) : _apiFactory = apiFactory ?? ((origin) => ServiceApi(origin)),
       timeout = connectionTimeout ?? const Duration(seconds: 8);
  final ServiceApiFactory _apiFactory;
  final Duration timeout;

  Future<ConnectedService> connect(String value) async {
    final origin = ServiceOrigin.parse(value);
    final api = _apiFactory(origin);
    try {
      final health = await api
          .request('GET', '/api/v1/health')
          .timeout(timeout, onTimeout: _timeout);
      if (health is! Map || health['status'] != 'ok') {
        throw const ServiceException(
          'SERVICE_UNHEALTHY',
          'The configured Service is not healthy.',
        );
      }
      final capabilities = Capabilities.fromJson(
        await api
            .request('GET', '/api/v1/capabilities')
            .timeout(timeout, onTimeout: _timeout),
      );
      if (capabilities.apiVersion != 'v1') {
        throw ServiceException(
          'UNSUPPORTED_API_VERSION',
          'This client requires Service API v1, received ${capabilities.apiVersion}.',
        );
      }
      return ConnectedService(
        origin: origin,
        api: api,
        capabilities: capabilities,
      );
    } on Object {
      api.close();
      rethrow;
    }
  }

  Future<ConnectionDiagnostics> diagnostics(String value) async {
    final stopwatch = Stopwatch()..start();
    final connected = await connect(value);
    stopwatch.stop();
    final result = ConnectionDiagnostics(
      origin: connected.origin.uri.toString(),
      connected: true,
      latency: stopwatch.elapsed,
      apiVersion: connected.capabilities.apiVersion,
      checkedAt: DateTime.now(),
    );
    connected.api.close();
    return result;
  }

  Never _timeout() => throw const ServiceException(
    'CONNECTION_TIMEOUT',
    'The Service did not respond in time. Check the address and port.',
  );
}
