import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/design/components/playback_progress.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

void main() {
  testWidgets('playback progress keeps times aligned and supports seeking', (
    tester,
  ) async {
    Duration? seeked;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 420,
              child: PlaybackProgress(
                position: const Duration(minutes: 1, seconds: 5),
                duration: const Duration(minutes: 4, seconds: 5),
                onSeek: (value) => seeked = value,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('1:05'), findsOneWidget);
    expect(find.text('4:05'), findsOneWidget);
    expect(
      tester.getCenter(find.text('1:05')).dy,
      tester.getCenter(find.text('4:05')).dy,
    );
    expect(
      tester
          .getSize(find.byKey(const Key('playback-progress-hit-area')))
          .height,
      28,
    );
    expect(tester.getSize(find.text('1:05')).width, lessThanOrEqualTo(42));
    expect(tester.getSize(find.text('4:05')).width, lessThanOrEqualTo(42));

    final sliderRect = tester.getRect(
      find.byKey(const Key('playback-progress-hit-area')),
    );
    final gesture = await tester.startGesture(
      Offset(sliderRect.left + sliderRect.width * 0.25, sliderRect.center.dy),
    );
    await gesture.moveTo(
      Offset(sliderRect.left + sliderRect.width * 0.75, sliderRect.center.dy),
    );
    await gesture.up();
    await tester.pump();
    expect(seeked, isNotNull);
    expect(seeked!.inSeconds, greaterThan(180));
  });

  testWidgets('playback progress disables seeking without a duration', (
    tester,
  ) async {
    var seekCount = 0;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: PlaybackProgress(
            position: Duration.zero,
            duration: Duration.zero,
            onSeek: (_) => seekCount += 1,
          ),
        ),
      ),
    );

    await tester.tapAt(tester.getCenter(find.byType(ShadSlider)));
    await tester.pump();

    expect(seekCount, 0);
  });
}
