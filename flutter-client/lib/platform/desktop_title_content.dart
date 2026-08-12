import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design/design_tokens.dart';
import '../l10n/app_localizations.dart';

final class DesktopTitleContent extends StatelessWidget {
  const DesktopTitleContent({
    super.key,
    required this.location,
    required this.leadingInset,
    required this.trailingInset,
    this.onBack,
    this.onSearch,
  });

  final String location;
  final double leadingInset;
  final double trailingInset;
  final VoidCallback? onBack;
  final VoidCallback? onSearch;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final pageTitle = switch (location) {
      final value when value.startsWith('/search') => l10n.desktopTitleSearch,
      final value when value.startsWith('/square') => l10n.desktopTitleSquare,
      final value when value.startsWith('/charts') => l10n.desktopTitleCharts,
      final value when value.startsWith('/playlists') =>
        l10n.desktopTitlePlaylists,
      final value when value.startsWith('/downloads') =>
        l10n.desktopTitleDownloads,
      final value when value.startsWith('/sources') => l10n.desktopTitleSources,
      final value when value.startsWith('/settings') =>
        l10n.desktopTitleSettings,
      final value when value.startsWith('/player') => l10n.desktopTitlePlayer,
      final value when value.startsWith('/states') => l10n.desktopTitleStates,
      _ => l10n.desktopTitleHome,
    };

    return Stack(
      children: [
        Positioned.fill(
          child: Padding(
            padding: EdgeInsets.only(left: leadingInset, right: trailingInset),
            child: Row(
              children: [
                _TitleAction(
                  icon: LucideIcons.chevronLeft,
                  label: '返回',
                  onPressed: onBack,
                ),
                const SizedBox(width: 4),
                const _TitleAction(icon: LucideIcons.chevronRight, label: '前进'),
              ],
            ),
          ),
        ),
        Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '$pageTitle · ${l10n.appTitle}',
                style: AppTypography.metadata.copyWith(
                  color: AppTokens.of(context).foregroundSecondary,
                ),
              ),
              const SizedBox(width: 10),
              _TitleAction(
                icon: LucideIcons.search,
                label: '全局搜索',
                onPressed: onSearch,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

final class _TitleAction extends StatelessWidget {
  const _TitleAction({required this.icon, required this.label, this.onPressed});

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: label,
    child: ShadButton.raw(
      variant: ShadButtonVariant.ghost,
      width: 38,
      height: 38,
      padding: EdgeInsets.zero,
      enabled: onPressed != null,
      onPressed: onPressed,
      child: Icon(icon, size: 17),
    ),
  );
}
