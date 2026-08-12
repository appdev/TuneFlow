import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../design/components/status_badge.dart';
import '../../design/design_tokens.dart';

final class MoreScreen extends StatelessWidget {
  const MoreScreen({
    super.key,
    required this.serviceHost,
    required this.onSources,
    required this.onSettings,
    required this.onSquare,
    required this.onCharts,
  });

  final String serviceHost;
  final VoidCallback onSources;
  final VoidCallback onSettings;
  final VoidCallback onSquare;
  final VoidCallback onCharts;

  @override
  Widget build(BuildContext context) => ColoredBox(
    key: const Key('more-mobile-layout'),
    color: AppTokens.of(context).background,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                '更多',
                style: TextStyle(
                  fontFamily: AppTypography.fontFamily,
                  fontSize: 31,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const AppStatusBadge(label: '已连接', tone: StatusTone.success),
          ],
        ),
        const SizedBox(height: 24),
        _MoreTile(title: '歌单广场', onTap: onSquare),
        _MoreTile(title: '排行榜', onTap: onCharts),
        _MoreTile(title: '音源管理', onTap: onSources),
        _MoreTile(title: '设置', onTap: onSettings),
        Semantics(
          label: 'Service $serviceHost 已连接',
          child: _MoreTile(
            title: 'Service 已连接',
            trailing: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTokens.of(context).success,
              ),
            ),
            onTap: onSettings,
          ),
        ),
      ],
    ),
  );
}

final class _MoreTile extends StatelessWidget {
  const _MoreTile({required this.title, required this.onTap, this.trailing});
  final String title;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Container(
    height: 56,
    margin: const EdgeInsets.only(bottom: 10),
    decoration: BoxDecoration(
      color: AppTokens.of(context).surface,
      border: Border.all(color: AppTokens.of(context).border),
      borderRadius: BorderRadius.circular(AppRadii.compactCard),
    ),
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadii.compactCard),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Row(
            children: [
              Expanded(child: Text(title, style: AppTypography.title)),
              trailing ?? const Icon(LucideIcons.chevronRight, size: 18),
            ],
          ),
        ),
      ),
    ),
  );
}
