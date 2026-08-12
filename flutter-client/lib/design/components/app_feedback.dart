import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'app_button.dart';

final class AppNotice extends StatelessWidget {
  const AppNotice({
    super.key,
    required this.title,
    required this.message,
    this.compact = false,
  }) : destructive = false;

  const AppNotice.error({super.key, required this.title, required this.message})
    : destructive = true,
      compact = false;

  final String title;
  final String message;
  final bool destructive;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact && !destructive) {
      final colors = ShadTheme.of(context).colorScheme;
      return Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
        decoration: BoxDecoration(
          color: colors.primary.withValues(alpha: .055),
          border: Border.all(color: colors.border),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(title, style: TextStyle(color: colors.mutedForeground)),
        ),
      );
    }
    final icon = Icon(destructive ? LucideIcons.circleAlert : LucideIcons.info);
    final titleWidget = Text(title);
    final description = Text(message);
    return destructive
        ? ShadAlert.destructive(
            icon: icon,
            title: titleWidget,
            description: description,
          )
        : ShadAlert(icon: icon, title: titleWidget, description: description);
  }
}

Future<bool> showAppDestructiveDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String cancelLabel,
  required String confirmLabel,
}) async =>
    await showShadDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => ShadDialog.alert(
        title: Text(title),
        description: Text(message),
        actions: [
          AppButton(
            variant: ShadButtonVariant.outline,
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(cancelLabel),
          ),
          AppButton(
            variant: ShadButtonVariant.destructive,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    ) ??
    false;

Object? showAppMessage(
  BuildContext context, {
  required String title,
  required String message,
  bool destructive = false,
}) {
  final toast = destructive
      ? ShadToast.destructive(title: Text(title), description: Text(message))
      : ShadToast(title: Text(title), description: Text(message));
  return ShadSonner.of(context).show(toast);
}

Future<T?> showAppSheet<T>(
  BuildContext context, {
  required String title,
  required Widget child,
}) => showShadSheet<T>(
  context: context,
  side: ShadSheetSide.bottom,
  builder: (sheetContext) => ShadSheet(title: Text(title), child: child),
);
