import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design_tokens.dart';

enum StatusTone { neutral, success, warning, danger }

final class AppStatusBadge extends StatelessWidget {
  const AppStatusBadge({
    super.key,
    required this.label,
    this.tone = StatusTone.neutral,
  });

  final String label;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    final foreground = switch (tone) {
      StatusTone.neutral => tokens.foregroundSecondary,
      StatusTone.success => tokens.success,
      StatusTone.warning => tokens.warning,
      StatusTone.danger => tokens.danger,
    };
    return ShadBadge.secondary(
      backgroundColor: foreground.withValues(alpha: .12),
      foregroundColor: foreground,
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: foreground,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(label),
        ],
      ),
    );
  }
}
