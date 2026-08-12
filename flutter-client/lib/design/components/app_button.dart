import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

final class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.loading = false,
    this.variant = ShadButtonVariant.primary,
    this.leading,
    this.expands = false,
  });

  final Widget child;
  final VoidCallback? onPressed;
  final bool loading;
  final ShadButtonVariant variant;
  final Widget? leading;
  final bool expands;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
    child: ShadButton.raw(
      variant: variant,
      height: 48,
      expands: expands,
      enabled: !loading && onPressed != null,
      onPressed: loading ? null : onPressed,
      leading: loading
          ? SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: ShadTheme.of(context).colorScheme.primaryForeground,
              ),
            )
          : leading,
      child: child,
    ),
  );
}
