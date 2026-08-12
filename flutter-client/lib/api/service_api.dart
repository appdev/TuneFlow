import 'dart:convert';

import 'package:http/http.dart' as http;

import 'service_exception.dart';
import 'service_origin.dart';

final class ServiceApi {
  ServiceApi(this.origin, {http.Client? client})
    : _client = client ?? http.Client(),
      _ownsClient = client == null;

  final ServiceOrigin origin;
  final http.Client _client;
  final bool _ownsClient;

  Future<Object?> request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? headers,
  }) async {
    final request = http.Request(method, origin.resolve(path))
      ..followRedirects = false
      ..headers.addAll({'accept': 'application/json', ...?headers});
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }

    late http.StreamedResponse streamed;
    try {
      streamed = await _client.send(request);
    } on ServiceException {
      rethrow;
    } on Object catch (error) {
      throw ServiceException(
        'NETWORK_ERROR',
        'Unable to reach the Service.',
        details: error.toString(),
      );
    }

    final responseBody = await streamed.stream.bytesToString();
    if (streamed.statusCode >= 300 && streamed.statusCode < 400) {
      throw ServiceException(
        'REDIRECT_REJECTED',
        'Service redirects are not accepted.',
        status: streamed.statusCode,
      );
    }
    if (streamed.statusCode == 204) return null;

    Object? decoded;
    try {
      decoded = responseBody.isEmpty ? null : jsonDecode(responseBody);
    } on FormatException catch (error) {
      throw ServiceException(
        'INVALID_RESPONSE',
        'Service returned invalid JSON.',
        status: streamed.statusCode,
        details: error.message,
      );
    }

    if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
      if (decoded is! Map || !decoded.containsKey('data')) {
        throw ServiceException(
          'INVALID_RESPONSE',
          'Service success response is missing the data envelope.',
          status: streamed.statusCode,
        );
      }
      return decoded['data'];
    }

    if (decoded is Map && decoded['error'] is Map) {
      final error = decoded['error'] as Map;
      final code = error['code'];
      final message = error['message'];
      if (code is String && message is String) {
        throw ServiceException(
          code,
          message,
          status: streamed.statusCode,
          details: error['details'],
        );
      }
    }
    throw ServiceException(
      'HTTP_ERROR',
      'Service request failed with HTTP ${streamed.statusCode}.',
      status: streamed.statusCode,
    );
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
