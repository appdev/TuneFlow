import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/components/app_feedback.dart';
import 'search_track_metadata.dart';
import 'track_action.dart';
import 'track_action_sheet.dart';

bool get usesMobileTrackActions =>
    defaultTargetPlatform == TargetPlatform.android ||
    defaultTargetPlatform == TargetPlatform.iOS;

Future<void> showMobileTrackActions(
  BuildContext context, {
  required Track track,
  required SearchTrackMetadata metadata,
  required List<TrackAction> actions,
}) => showAppSheet<void>(
  context,
  title: track.title.isEmpty ? track.id : track.title,
  child: TrackActionSheet(track: track, metadata: metadata, actions: actions),
);

final class DesktopTrackActionsButton extends StatefulWidget {
  const DesktopTrackActionsButton({
    super.key,
    required this.actions,
    required this.child,
  });

  final List<TrackAction> actions;
  final Widget Function(VoidCallback open) child;

  @override
  State<DesktopTrackActionsButton> createState() =>
      _DesktopTrackActionsButtonState();
}

final class _DesktopTrackActionsButtonState
    extends State<DesktopTrackActionsButton> {
  final controller = ShadPopoverController();

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ShadPopover(
    key: const Key('desktop-track-action-popover'),
    controller: controller,
    popover: (_) => SizedBox(
      width: 230,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: _actionItems(widget.actions, close: controller.hide),
      ),
    ),
    child: widget.child(controller.toggle),
  );
}

final class DesktopTrackContextRegion extends StatelessWidget {
  const DesktopTrackContextRegion({
    super.key,
    required this.actions,
    required this.child,
  });

  final List<TrackAction> actions;
  final Widget child;

  @override
  Widget build(BuildContext context) => ShadContextMenuRegion(
    key: const Key('desktop-track-context-region'),
    constraints: const BoxConstraints(minWidth: 230),
    items: _actionItems(actions),
    child: child,
  );
}

List<Widget> _actionItems(List<TrackAction> actions, {VoidCallback? close}) =>
    actions
        .map(
          (action) => ShadContextMenuItem(
            key: Key('desktop-track-action-${action.id.name}'),
            enabled: action.enabled,
            leading: Icon(action.icon, size: 16),
            onPressed: action.enabled
                ? () {
                    close?.call();
                    unawaited(action.invoke());
                  }
                : null,
            child: Text(action.disabledReason ?? action.label),
          ),
        )
        .toList(growable: false);
