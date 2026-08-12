import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design_tokens.dart';

final class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.caption,
  });

  final String label;
  final String value;
  final IconData icon;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return ShadCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      radius: BorderRadius.circular(AppRadii.compactCard),
      backgroundColor: tokens.surface,
      shadows: AppShadows.panel,
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: tokens.surfaceWarm,
              borderRadius: BorderRadius.circular(AppRadii.control),
            ),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Icon(icon, color: tokens.accent, size: 20),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTypography.metadata.copyWith(color: tokens.muted),
                ),
                const SizedBox(height: 3),
                Text(value, style: AppTypography.title),
                if (caption != null)
                  Text(
                    caption!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.metadata.copyWith(
                      color: tokens.foregroundSecondary,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
