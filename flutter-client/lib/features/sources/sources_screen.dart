import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../design/app_breakpoints.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/status_badge.dart';
import '../../design/design_tokens.dart';
import 'source_repository.dart';
import 'sources_controller.dart';

final class SourcesScreen extends StatefulWidget {
  const SourcesScreen({super.key, required this.controller});
  final SourcesController controller;

  @override
  State<SourcesScreen> createState() => _SourcesScreenState();
}

final class _SourcesScreenState extends State<SourcesScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.refresh();
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final state = widget.controller.state;
      final mobile =
          classifyLayout(MediaQuery.sizeOf(context).width) ==
          AppLayoutClass.mobile;
      return ColoredBox(
        key: Key(mobile ? 'sources-mobile-layout' : 'sources-wide-layout'),
        color: AppTokens.of(context).background,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            mobile ? 16 : 38,
            mobile ? 20 : 34,
            mobile ? 16 : 38,
            48,
          ),
          children: [
            const Text('GET /api/v1/sources', style: AppTypography.metadata),
            const SizedBox(height: 4),
            Text(
              '音源管理',
              style: mobile
                  ? AppTypography.display.copyWith(fontSize: 31)
                  : AppTypography.display,
            ),
            if (state.loading) ...[
              const SizedBox(height: 18),
              const LinearProgressIndicator(minHeight: 2),
            ],
            if (state.error != null) ...[
              const SizedBox(height: 18),
              AppNotice.error(title: '音源操作失败', message: state.error.toString()),
            ],
            const SizedBox(height: 24),
            if (!state.loading && state.items.isEmpty)
              const _EmptySources()
            else
              Column(
                children: [
                  for (final item in state.items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _SourceCard(
                        source: item,
                        mobile: mobile,
                        switching: state.switchingId == item.id,
                        onActivate: () => widget.controller.activate(item.id),
                      ),
                    ),
                ],
              ),
          ],
        ),
      );
    },
  );
}

final class _SourceCard extends StatelessWidget {
  const _SourceCard({
    required this.source,
    required this.mobile,
    required this.switching,
    required this.onActivate,
  });
  final InstalledMusicSource source;
  final bool mobile;
  final bool switching;
  final VoidCallback onActivate;

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.all(18),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      source.name.isEmpty ? source.id : source.name,
                      style: AppTypography.title,
                    ),
                  ),
                  if (!mobile && source.active)
                    const AppStatusBadge(
                      label: '当前启用',
                      tone: StatusTone.success,
                    ),
                ],
              ),
              Text(
                'v${source.version} · ${source.active ? '当前启用' : '已安装'}',
                style: AppTypography.metadata.copyWith(
                  color: AppTokens.of(context).foregroundSecondary,
                ),
              ),
              if (!mobile) ...[
                const SizedBox(height: 8),
                Text(
                  source.description,
                  style: AppTypography.metadata.copyWith(
                    color: AppTokens.of(context).foregroundSecondary,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  AppStatusBadge(
                    label: mobile
                        ? source.providers.map((item) => item.id).join(' / ')
                        : 'sources: ${source.providers.map((item) => item.id).join(' / ')}',
                  ),
                  if (!mobile)
                    AppStatusBadge(
                      label:
                          'qualitys: ${source.providers.expand((item) => item.qualities).toSet().join(' / ')}',
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 18),
        if (source.active && mobile)
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppTokens.of(context).success,
            ),
          )
        else
          ShadButton(
            enabled: !source.active && !switching,
            onPressed: onActivate,
            child: Text(
              source.active
                  ? '能力详情'
                  : switching
                  ? '正在切换'
                  : '启用',
            ),
          ),
      ],
    ),
  );
}

final class _EmptySources extends StatelessWidget {
  const _EmptySources();

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.all(28),
    child: Column(
      children: [
        Icon(
          LucideIcons.audioLines,
          size: 32,
          color: AppTokens.of(context).muted,
        ),
        const SizedBox(height: 12),
        const Text('尚未安装音源', style: AppTypography.section),
        const SizedBox(height: 6),
        Text(
          '请先在 Service 管理端安装音源脚本。',
          style: AppTypography.body.copyWith(
            color: AppTokens.of(context).muted,
          ),
        ),
      ],
    ),
  );
}
