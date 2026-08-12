import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/api/sse_transport.dart';

void main() {
  test('parses fragmented comments and multi-line SSE data exactly once', () {
    final parser = SseParser();
    final bytes = utf8.encode(
      ': connected\n\n'
      'event: downloads.updated\n'
      'data: {"type":"downloads.updated",\n'
      'data: "data":[],"sequence":9}\n\n',
    );

    final events = <DomainEvent>[];
    events.addAll(parser.add(bytes.sublist(0, 11)));
    events.addAll(parser.add(bytes.sublist(11, 37)));
    events.addAll(parser.add(bytes.sublist(37)));

    expect(events, hasLength(1));
    expect(events.single.type, 'downloads.updated');
    expect(events.single.sequence, 9);
  });

  test('ignores an older sequence', () {
    final parser = SseParser(initialSequence: 9);
    final events = parser.add(
      utf8.encode(
        'data: {"type":"old","data":null,"sequence":8}\n\n'
        'data: {"type":"new","data":null,"sequence":10}\n\n',
      ),
    );

    expect(events.map((event) => event.type), ['new']);
    expect(parser.sequence, 10);
  });
}
