import '../../api/models.dart';

final class TimedLyricLine {
  const TimedLyricLine({
    required this.time,
    required this.text,
    this.translation,
  });

  final Duration time;
  final String text;
  final String? translation;
}

List<TimedLyricLine> parseLyricsTimeline(Lyrics lyrics) {
  final original = _parseLrc(lyrics.original);
  final translated = _parseLrc(lyrics.translation ?? '');
  return original.entries
      .map(
        (entry) => TimedLyricLine(
          time: Duration(milliseconds: entry.key),
          text: entry.value,
          translation: translated[entry.key],
        ),
      )
      .toList(growable: false);
}

int activeLyricIndex(List<TimedLyricLine> lines, Duration position) {
  var low = 0;
  var high = lines.length - 1;
  var result = -1;
  while (low <= high) {
    final middle = low + ((high - low) >> 1);
    if (lines[middle].time <= position) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

Map<int, String> _parseLrc(String source) {
  final result = <int, String>{};
  final timestamp = RegExp(r'\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]');
  for (final rawLine in source.split(RegExp(r'\r?\n'))) {
    final matches = timestamp.allMatches(rawLine).toList(growable: false);
    if (matches.isEmpty) continue;
    final text = rawLine.replaceAll(timestamp, '').trim();
    for (final match in matches) {
      final minutes = int.parse(match.group(1)!);
      final seconds = int.parse(match.group(2)!);
      final fraction = match.group(3) ?? '0';
      final milliseconds = switch (fraction.length) {
        1 => int.parse(fraction) * 100,
        2 => int.parse(fraction) * 10,
        _ => int.parse(fraction.padRight(3, '0').substring(0, 3)),
      };
      result[(minutes * 60 + seconds) * 1000 + milliseconds] = text;
    }
  }
  return Map.fromEntries(
    result.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
  );
}
