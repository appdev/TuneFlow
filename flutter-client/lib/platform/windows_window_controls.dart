import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design/design_tokens.dart';
import 'desktop_window_controller.dart';

final class WindowsWindowControls extends StatelessWidget {
  const WindowsWindowControls({super.key, required this.controller});

  final DesktopWindowController controller;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: controller.maximized,
    builder: (context, maximized, _) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _WindowsCaptionButton(
          key: const Key('window-minimize'),
          icon: LucideIcons.minus,
          label: '最小化',
          onPressed: controller.minimize,
        ),
        _WindowsCaptionButton(
          key: const Key('window-maximize'),
          icon: maximized ? LucideIcons.copy : LucideIcons.square,
          label: maximized ? '还原' : '最大化',
          onPressed: controller.toggleMaximize,
        ),
        _WindowsCaptionButton(
          key: const Key('window-close'),
          icon: LucideIcons.x,
          label: '关闭',
          danger: true,
          onPressed: controller.close,
        ),
      ],
    ),
  );
}

final class _WindowsCaptionButton extends StatefulWidget {
  const _WindowsCaptionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final Future<void> Function() onPressed;
  final bool danger;

  @override
  State<_WindowsCaptionButton> createState() => _WindowsCaptionButtonState();
}

final class _WindowsCaptionButtonState extends State<_WindowsCaptionButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: ColoredBox(
        color: !_hovered
            ? Colors.transparent
            : widget.danger
            ? tokens.danger
            : tokens.surfaceWarm,
        child: Tooltip(
          message: widget.label,
          child: ShadButton.raw(
            variant: ShadButtonVariant.ghost,
            width: 46,
            height: 38,
            padding: EdgeInsets.zero,
            onPressed: widget.onPressed,
            child: Icon(
              widget.icon,
              size: 14,
              color: _hovered && widget.danger ? Colors.white : tokens.muted,
            ),
          ),
        ),
      ),
    );
  }
}
