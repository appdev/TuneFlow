import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../design_tokens.dart';
import 'artwork.dart';

final class QueuePanel extends StatelessWidget {
  const QueuePanel({
    super.key,
    required this.tracks,
    required this.currentIndex,
    required this.onSelected,
    this.compact = false,
  });

  final List<Track> tracks;
  final int currentIndex;
  final ValueChanged<int> onSelected;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return ShadCard(
      padding: EdgeInsets.all(compact ? AppSpacing.sm : AppSpacing.md),
      radius: BorderRadius.circular(AppRadii.card),
      backgroundColor: tokens.surface,
      title: Row(
        children: [
          const Expanded(child: Text('播放队列')),
          AppStatusBadgeText('${tracks.length} 首'),
        ],
      ),
      child: tracks.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
              child: Center(
                child: Text(
                  '队列为空',
                  style: TextStyle(color: tokens.foregroundSecondary),
                ),
              ),
            )
          : Column(
              children: [
                for (var index = 0; index < tracks.length; index++)
                  _QueueRow(
                    key: Key('queue-track-${tracks[index].id}'),
                    track: tracks[index],
                    active: index == currentIndex,
                    onPressed: () => onSelected(index),
                  ),
              ],
            ),
    );
  }
}

final class AppStatusBadgeText extends StatelessWidget {
  const AppStatusBadgeText(this.value, {super.key});
  final String value;

  @override
  Widget build(BuildContext context) => Text(
    value,
    style: AppTypography.metadata.copyWith(color: AppTokens.of(context).muted),
  );
}

final class _QueueRow extends StatelessWidget {
  const _QueueRow({
    super.key,
    required this.track,
    required this.active,
    required this.onPressed,
  });

  final Track track;
  final bool active;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return Semantics(
      button: true,
      selected: active,
      label: '${track.title}，${track.artist}',
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadii.control),
        onTap: onPressed,
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
          decoration: BoxDecoration(
            color: active ? tokens.accent.withValues(alpha: .1) : null,
            borderRadius: BorderRadius.circular(AppRadii.control),
          ),
          child: Row(
            children: [
              AppArtwork(
                imageUrl: track.raw['pic'] as String?,
                seed: '${track.source}:${track.id}',
                semanticLabel: '${track.title}封面',
                size: 40,
                borderRadius: 8,
                showFallback: false,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      track.title.isEmpty ? track.id : track.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.title.copyWith(fontSize: 14),
                    ),
                    Text(
                      track.artist,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.metadata.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
              if (active)
                Icon(LucideIcons.audioLines, color: tokens.accent, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
