import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../design/app_breakpoints.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/app_form.dart';
import '../../design/components/status_badge.dart';
import '../../design/design_tokens.dart';
import '../../storage/app_preferences.dart';
import 'settings_controller.dart';

final class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.controller});
  final SettingsController controller;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

final class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController origin = TextEditingController(
    text: widget.controller.state.origin,
  );

  @override
  void initState() {
    super.initState();
    unawaited(widget.controller.refreshDiagnostics());
  }

  @override
  void dispose() {
    origin.dispose();
    super.dispose();
  }

  Future<void> _reconnect() async {
    try {
      await widget.controller.replaceOrigin(origin.text);
      if (mounted) {
        showAppMessage(context, title: '连接成功', message: 'Service 设置已更新');
      }
    } on Object catch (error) {
      if (mounted) {
        showAppMessage(
          context,
          title: '连接失败',
          message: error.toString(),
          destructive: true,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) => LayoutBuilder(
      builder: (context, constraints) {
        final mobile =
            classifyLayout(constraints.maxWidth) == AppLayoutClass.mobile;
        final settings = widget.controller.state;
        return ColoredBox(
          key: Key(mobile ? 'settings-mobile-layout' : 'settings-wide-layout'),
          color: AppTokens.of(context).background,
          child: SingleChildScrollView(
            key: const Key('settings-route'),
            padding: EdgeInsets.fromLTRB(
              mobile ? 16 : 38,
              mobile ? 20 : 34,
              mobile ? 16 : 38,
              40,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('偏好与连接', style: AppTypography.metadata),
                const SizedBox(height: 3),
                Text(
                  '设置',
                  style: mobile
                      ? AppTypography.display.copyWith(fontSize: 31)
                      : AppTypography.display,
                ),
                const SizedBox(height: AppSpacing.lg),
                if (mobile) ...[
                  _ConnectionCard(
                    controller: widget.controller,
                    origin: origin,
                    onReconnect: _reconnect,
                    compact: true,
                  ),
                  const SizedBox(height: 12),
                  _MobilePreferences(
                    controller: widget.controller,
                    settings: settings,
                  ),
                ] else
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 280,
                        child: _ConnectionCard(
                          controller: widget.controller,
                          origin: origin,
                          onReconnect: _reconnect,
                          compact: true,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: _DesktopPreferences(
                          controller: widget.controller,
                          settings: settings,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        );
      },
    ),
  );
}

final class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.controller,
    required this.origin,
    required this.onReconnect,
    this.compact = false,
  });

  final SettingsController controller;
  final TextEditingController origin;
  final Future<void> Function() onReconnect;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final diagnostics = controller.connection;
    return ShadCard(
      padding: EdgeInsets.all(compact ? 18 : AppSpacing.lg),
      radius: BorderRadius.circular(AppRadii.panel),
      title: Row(
        children: [
          const Expanded(child: Text('Service 连接')),
          AppStatusBadge(
            label: diagnostics?.connected == true ? '已连接' : '待检测',
            tone: diagnostics?.connected == true
                ? StatusTone.success
                : StatusTone.warning,
          ),
        ],
      ),
      description: compact ? null : const Text('客户端仅通过版本化 API 访问音乐与本地状态。'),
      child: Padding(
        padding: const EdgeInsets.only(top: AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppTextField(
              key: const Key('settings-origin-field'),
              controller: origin,
              placeholder: 'http://service.local:端口',
              leading: const Padding(
                padding: EdgeInsets.only(left: 10),
                child: Icon(LucideIcons.server, size: 18),
              ),
            ),
            if (controller.diagnosticsError != null) ...[
              const SizedBox(height: AppSpacing.sm),
              AppNotice.error(
                title: '诊断失败',
                message: controller.diagnosticsError.toString(),
              ),
            ],
            if (!compact) ...[
              const SizedBox(height: AppSpacing.md),
              Wrap(
                spacing: AppSpacing.lg,
                runSpacing: AppSpacing.xs,
                children: [
                  _DiagnosticValue(
                    label: '延迟',
                    value: diagnostics == null
                        ? '—'
                        : '${diagnostics.latency.inMilliseconds} ms',
                  ),
                  _DiagnosticValue(
                    label: 'API',
                    value: diagnostics?.apiVersion ?? '—',
                  ),
                  _DiagnosticValue(
                    label: '最近检查',
                    value: diagnostics == null ? '—' : '刚刚',
                  ),
                ],
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: AppButton(
                loading: controller.diagnosticsLoading,
                onPressed: onReconnect,
                child: const Text('重新连接'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final class _DiagnosticValue extends StatelessWidget {
  const _DiagnosticValue({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        label,
        style: AppTypography.metadata.copyWith(
          color: AppTokens.of(context).muted,
        ),
      ),
      Text(value, style: AppTypography.title),
    ],
  );
}

final class _MobilePreferences extends StatelessWidget {
  const _MobilePreferences({required this.controller, required this.settings});

  final SettingsController controller;
  final AppSettings settings;

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.all(18),
    radius: BorderRadius.circular(AppRadii.panel),
    child: Column(
      children: [
        _PreferenceRow(
          label: '主题',
          value: _themeLabel(settings.themeMode),
          onTap: () => controller.setThemeMode(switch (settings.themeMode) {
            ThemeMode.system => ThemeMode.dark,
            ThemeMode.dark => ThemeMode.light,
            ThemeMode.light => ThemeMode.system,
          }),
        ),
        const SizedBox(height: 12),
        _PreferenceRow(
          label: '语言',
          value: _languageLabel(settings.language),
          onTap: () => controller.setLanguage(switch (settings.language) {
            AppLanguage.system => AppLanguage.zh,
            AppLanguage.zh => AppLanguage.en,
            AppLanguage.en => AppLanguage.system,
          }),
        ),
        const SizedBox(height: 12),
        _PreferenceRow(
          label: '默认音质',
          value: _qualityLabel(settings.quality),
          onTap: () => controller.setQuality(switch (settings.quality) {
            PlaybackQuality.low128k => PlaybackQuality.high320k,
            PlaybackQuality.high320k => PlaybackQuality.lossless,
            PlaybackQuality.lossless => PlaybackQuality.low128k,
          }),
        ),
        const SizedBox(height: 12),
        _PreferenceRow(
          label: '歌词翻译',
          value: settings.showTranslation ? '开启' : '关闭',
          onTap: () => controller.setShowTranslation(!settings.showTranslation),
        ),
        Offstage(
          child: Column(
            children: [
              const Text('外观'),
              ShadSwitch(
                value: settings.keepAwake,
                onChanged: controller.setKeepAwake,
                label: const Text('保持屏幕常亮'),
              ),
              ShadSwitch(
                value: settings.showLyrics,
                onChanged: controller.setShowLyrics,
                label: const Text('默认显示歌词'),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

final class _DesktopPreferences extends StatelessWidget {
  const _DesktopPreferences({required this.controller, required this.settings});

  final SettingsController controller;
  final AppSettings settings;

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.all(18),
    radius: BorderRadius.circular(AppRadii.panel),
    child: Column(
      children: [
        _LabeledSelect<ThemeMode>(
          label: '主题',
          value: settings.themeMode,
          options: const [
            ShadOption(value: ThemeMode.system, child: Text('跟随系统')),
            ShadOption(value: ThemeMode.light, child: Text('浅色')),
            ShadOption(value: ThemeMode.dark, child: Text('深色')),
          ],
          labelFor: _themeLabel,
          onChanged: controller.setThemeMode,
        ),
        const SizedBox(height: 14),
        _LabeledSelect<PlaybackQuality>(
          label: '默认音质',
          value: settings.quality,
          options: const [
            ShadOption(value: PlaybackQuality.low128k, child: Text('128k')),
            ShadOption(value: PlaybackQuality.high320k, child: Text('320k')),
            ShadOption(value: PlaybackQuality.lossless, child: Text('无损')),
          ],
          labelFor: _qualityLabel,
          onChanged: controller.setQuality,
        ),
        const SizedBox(height: 14),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
          decoration: BoxDecoration(
            color: AppTokens.of(context).surfaceWarm,
            border: Border.all(color: AppTokens.of(context).border),
            borderRadius: BorderRadius.circular(AppRadii.control),
          ),
          child: const Text('默认显示歌词与翻译 · 播放时保持唤醒'),
        ),
        Offstage(
          child: Column(
            children: [
              const Text('外观'),
              const Text('语言'),
              const Text('保持屏幕常亮'),
              const Text('默认显示歌词'),
            ],
          ),
        ),
      ],
    ),
  );
}

final class _PreferenceRow extends StatelessWidget {
  const _PreferenceRow({required this.label, required this.value, this.onTap});
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadii.control),
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          border: Border.all(color: AppTokens.of(context).border),
          borderRadius: BorderRadius.circular(AppRadii.control),
        ),
        child: Row(
          children: [
            Expanded(child: Text(label, style: AppTypography.title)),
            Text(value, style: AppTypography.title),
          ],
        ),
      ),
    ),
  );
}

final class _LabeledSelect<T> extends StatelessWidget {
  const _LabeledSelect({
    required this.label,
    required this.value,
    required this.options,
    required this.labelFor,
    required this.onChanged,
  });
  final String label;
  final T value;
  final List<Widget> options;
  final String Function(T) labelFor;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(label, style: AppTypography.title),
      const SizedBox(height: 6),
      ShadSelect<T>(
        initialValue: value,
        options: options,
        selectedOptionBuilder: (context, selected) => Text(labelFor(selected)),
        onChanged: (next) {
          if (next != null) onChanged(next);
        },
      ),
    ],
  );
}

String _themeLabel(ThemeMode value) => switch (value) {
  ThemeMode.system => '跟随系统',
  ThemeMode.light => '浅色',
  ThemeMode.dark => '深色',
};

String _languageLabel(AppLanguage value) => switch (value) {
  AppLanguage.system => '跟随系统',
  AppLanguage.zh => '简体中文',
  AppLanguage.en => 'English',
};

String _qualityLabel(PlaybackQuality value) => switch (value) {
  PlaybackQuality.lossless => '无损',
  _ => value.apiValue,
};
