import 'package:flutter/material.dart';

import '../../design/components/app_states.dart';
import '../../design/design_tokens.dart';
import 'lyrics_timeline.dart';
import 'player_state.dart';

final class LyricsView extends StatelessWidget {
  const LyricsView({
    super.key,
    required this.state,
    this.verticalPadding = 120,
  });

  final PlayerState state;
  final double verticalPadding;

  @override
  Widget build(BuildContext context) {
    final lyrics = state.lyrics;
    if (lyrics == null ||
        (lyrics.original.isEmpty && (lyrics.translation?.isEmpty ?? true))) {
      return const AppEmptyState(message: '暂无歌词');
    }
    final lines = parseLyricsTimeline(lyrics);
    if (lines.isEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: SelectableText(lyrics.original, textAlign: TextAlign.center),
      );
    }
    final active = activeLyricIndex(lines, state.position);
    return ListView.builder(
      key: ValueKey('lyrics-$active'),
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: verticalPadding),
      itemCount: lines.length,
      itemBuilder: (context, index) {
        final line = lines[index];
        final selected = index == active;
        return AnimatedDefaultTextStyle(
          duration: const Duration(milliseconds: 180),
          style: AppTypography.body.copyWith(
            fontSize: selected ? 28 : 20,
            height: 1.35,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
            color: selected
                ? AppTokens.of(context).foreground
                : AppTokens.of(context).muted,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Column(
              children: [
                Text(line.text, textAlign: TextAlign.center),
                if (state.showTranslation)
                  if (line.translation case final translation?)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        translation,
                        textAlign: TextAlign.center,
                        style: AppTypography.metadata.copyWith(
                          color: AppTokens.of(context).foregroundSecondary,
                        ),
                      ),
                    ),
              ],
            ),
          ),
        );
      },
    );
  }
}
