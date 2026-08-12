import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';
import 'service_api.dart';
import 'service_exception.dart';

final class SseParser {
  SseParser({int initialSequence = 0}) : sequence = initialSequence;

  final List<int> _bytes = [];
  String _text = '';
  int sequence;

  List<DomainEvent> add(List<int> bytes) {
    _bytes.addAll(bytes);
    String decoded;
    try {
      decoded = utf8.decode(_bytes);
    } on FormatException {
      return const [];
    }
    _bytes.clear();
    _text += decoded.replaceAll('\r\n', '\n');

    final events = <DomainEvent>[];
    var boundary = _text.indexOf('\n\n');
    while (boundary >= 0) {
      final block = _text.substring(0, boundary);
      _text = _text.substring(boundary + 2);
      final data = block
          .split('\n')
          .where((line) => line.startsWith('data:'))
          .map((line) => line.substring(5).trimLeft())
          .join('\n');
      if (data.isNotEmpty) {
        final event = DomainEvent.fromJson(jsonDecode(data));
        if (event.sequence > sequence) {
          sequence = event.sequence;
          events.add(event);
        }
      }
      boundary = _text.indexOf('\n\n');
    }
    return events;
  }
}

typedef ReconnectDelay = Future<void> Function(Duration duration);

final class SseTransport {
  SseTransport(this.api, {http.Client? client, ReconnectDelay? delay})
    : _client = client ?? http.Client(),
      _ownsClient = client == null,
      _customDelay = delay;

  final ServiceApi api;
  final http.Client _client;
  final bool _ownsClient;
  final ReconnectDelay? _customDelay;
  bool _closed = false;
  Timer? _reconnectTimer;
  Completer<void>? _reconnectCompleter;

  Future<void> _wait(Duration duration) {
    if (_customDelay case final delay?) return delay(duration);
    final completer = Completer<void>();
    _reconnectCompleter = completer;
    _reconnectTimer = Timer(duration, () {
      if (!completer.isCompleted) completer.complete();
    });
    return completer.future;
  }

  Stream<DomainEvent> events() async* {
    final parser = SseParser();
    var attempt = 0;
    while (!_closed) {
      try {
        final snapshot = EventSnapshot.fromJson(
          await api.request('GET', '/api/v1/events/snapshot'),
        );
        for (final event in snapshot.events) {
          if (event.sequence > parser.sequence) {
            parser.sequence = event.sequence;
            yield event;
          }
        }
        if (snapshot.sequence > parser.sequence) {
          parser.sequence = snapshot.sequence;
        }

        final request =
            http.Request('GET', api.origin.resolve('/api/v1/events'))
              ..followRedirects = false
              ..headers['accept'] = 'text/event-stream';
        final response = await _client.send(request);
        if (response.statusCode != 200) {
          throw ServiceException(
            'EVENT_STREAM_ERROR',
            'Event stream failed with HTTP ${response.statusCode}.',
            status: response.statusCode,
          );
        }
        attempt = 0;
        await for (final chunk in response.stream) {
          if (_closed) break;
          for (final event in parser.add(chunk)) {
            yield event;
          }
        }
      } on Object {
        if (_closed) break;
      }
      final milliseconds = attempt < 4 ? 250 * (1 << attempt) : 5000;
      attempt++;
      await _wait(Duration(milliseconds: milliseconds));
    }
  }

  void close() {
    _closed = true;
    _reconnectTimer?.cancel();
    final completer = _reconnectCompleter;
    if (completer != null && !completer.isCompleted) completer.complete();
    if (_ownsClient) _client.close();
  }
}
