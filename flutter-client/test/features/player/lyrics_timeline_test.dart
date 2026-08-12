import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/features/player/lyrics_timeline.dart';

void main() {
  test('parses multiple LRC timestamps and aligns translated lines', () {
    final lines = parseLyricsTimeline(
      const Lyrics(
        original: '[00:01.20]First\n[00:03.005][00:04.00]Second',
        translation: '[00:01.20]第一句\n[00:03.005]第二句',
      ),
    );

    expect(lines.map((line) => line.time.inMilliseconds), [1200, 3005, 4000]);
    expect(lines.first.translation, '第一句');
    expect(lines[1].translation, '第二句');
    expect(lines.last.translation, isNull);
  });

  test('active lyric index follows playback position at boundaries', () {
    const lines = [
      TimedLyricLine(time: Duration(seconds: 1), text: 'a'),
      TimedLyricLine(time: Duration(seconds: 3), text: 'b'),
    ];

    expect(activeLyricIndex(lines, const Duration(milliseconds: 999)), -1);
    expect(activeLyricIndex(lines, const Duration(seconds: 1)), 0);
    expect(activeLyricIndex(lines, const Duration(seconds: 4)), 1);
  });
}
