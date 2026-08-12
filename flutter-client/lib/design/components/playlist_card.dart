import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../design_tokens.dart';
import 'artwork.dart';

final class PlaylistCard extends StatelessWidget {
  const PlaylistCard({
    super.key,
    required this.playlist,
    required this.onPressed,
    this.onDelete,
    this.imageUrl,
    this.variant = PlaylistCardVariant.row,
  });

  final PlaylistSummary playlist;
  final VoidCallback onPressed;
  final VoidCallback? onDelete;
  final Uri? imageUrl;
  final PlaylistCardVariant variant;

  @override
  Widget build(BuildContext context) {
    if (variant == PlaylistCardVariant.gallery) {
      return Semantics(
        button: true,
        label: '打开${playlist.displayName}',
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadii.card),
            onTap: onPressed,
            onLongPress: onDelete,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (imageUrl != null) ...[
                  LayoutBuilder(
                    builder: (context, constraints) => AppArtwork(
                      imageUrl: imageUrl.toString(),
                      seed: playlist.id,
                      semanticLabel: '${playlist.displayName}封面',
                      size: constraints.maxWidth,
                      icon: LucideIcons.listMusic,
                      showFallback: false,
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                Text(
                  playlist.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.title,
                ),
                const SizedBox(height: 2),
                Text(
                  playlist is PlaylistDetail
                      ? '${(playlist as PlaylistDetail).tracks.length} 首'
                      : playlist.source?.isEmpty == false
                      ? playlist.source!
                      : 'Service 歌单',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.metadata.copyWith(
                    color: AppTokens.of(context).foregroundSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ShadCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      radius: BorderRadius.circular(AppRadii.card),
      backgroundColor: AppTokens.of(context).surface,
      shadows: AppShadows.panel,
      child: Row(
        children: [
          if (imageUrl != null) ...[
            AppArtwork(
              imageUrl: imageUrl.toString(),
              seed: playlist.id,
              semanticLabel: '${playlist.displayName}封面',
              size: 52,
              borderRadius: AppRadii.control,
              icon: LucideIcons.listMusic,
              showFallback: false,
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
          Expanded(
            child: Semantics(
              button: true,
              label: '打开${playlist.displayName}',
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: onPressed,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      playlist.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.title,
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (onDelete != null)
            IconButton(
              tooltip: '删除歌单',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: onDelete,
              icon: const Icon(LucideIcons.trash2),
            ),
        ],
      ),
    );
  }
}

enum PlaylistCardVariant { row, gallery }
