import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/components/app_button.dart';
import '../../design/design_tokens.dart';
import 'search_track_metadata.dart';
import 'track_action.dart';

final class TrackActionSheet extends StatelessWidget {
  const TrackActionSheet({
    super.key,
    required this.track,
    required this.metadata,
    required this.actions,
  });

  final Track track;
  final SearchTrackMetadata metadata;
  final List<TrackAction> actions;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8, bottom: 24),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          track.artist,
          style: AppTypography.metadata.copyWith(
            color: AppTokens.of(context).muted,
          ),
        ),
        if (metadata.qualityLabel case final quality?) ...[
          const SizedBox(height: 4),
          Text(
            quality,
            style: AppTypography.metadata.copyWith(
              color: AppTokens.of(context).accent,
            ),
          ),
        ],
        const SizedBox(height: 16),
        for (final action in actions)
          AppButton(
            key: Key('track-action-${action.id.name}'),
            variant: ShadButtonVariant.ghost,
            leading: Icon(action.icon),
            onPressed: action.enabled ? () => unawaited(action.invoke()) : null,
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(action.disabledReason ?? action.label),
            ),
          ),
      ],
    ),
  );
}
