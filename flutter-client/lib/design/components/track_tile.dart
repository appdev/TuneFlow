import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../design_tokens.dart';
import 'artwork.dart';

final class TrackTile extends StatelessWidget {
  const TrackTile({
    super.key,
    required this.track,
    required this.onPlay,
    required this.onActions,
    this.picture,
  });

  final Track track;
  final VoidCallback onPlay;
  final VoidCallback onActions;
  final Uri? picture;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    final embedded = track.raw['pic'];
    final effectivePicture =
        picture ??
        (embedded is String && embedded.isNotEmpty
            ? Uri.tryParse(embedded)
            : null);
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadii.control),
      onTap: onPlay,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 68),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  if (effectivePicture != null)
                    AppArtwork(
                      imageUrl: effectivePicture.toString(),
                      seed: '${track.source}:${track.id}',
                      semanticLabel: '${track.title}封面',
                      size: 52,
                      borderRadius: AppRadii.control,
                      showFallback: false,
                    ),
                  IconButton(
                    key: Key('play-track-${track.id}'),
                    tooltip: '播放',
                    constraints: const BoxConstraints(
                      minWidth: 48,
                      minHeight: 48,
                    ),
                    onPressed: onPlay,
                    icon: Icon(
                      LucideIcons.play,
                      color: tokens.accentForeground,
                      shadows: const [Shadow(blurRadius: 8)],
                    ),
                  ),
                ],
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
                      style: AppTypography.title,
                    ),
                    Text(
                      track.artist,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.metadata.copyWith(
                        color: tokens.foregroundSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                key: Key('actions-track-${track.id}'),
                tooltip: '更多操作',
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                onPressed: onActions,
                icon: const Icon(LucideIcons.ellipsisVertical),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
