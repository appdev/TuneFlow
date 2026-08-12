import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

final class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.controller,
    this.focusNode,
    this.initialValue,
    required this.placeholder,
    this.onChanged,
    this.onSubmitted,
    this.keyboardType,
    this.leading,
    this.trailing,
    this.enabled = true,
  });

  final TextEditingController? controller;
  final FocusNode? focusNode;
  final String? initialValue;
  final String placeholder;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputType? keyboardType;
  final Widget? leading;
  final Widget? trailing;
  final bool enabled;

  @override
  Widget build(BuildContext context) => ShadInput(
    controller: controller,
    focusNode: focusNode,
    initialValue: controller == null ? initialValue : null,
    placeholder: Text(placeholder),
    onChanged: onChanged,
    onSubmitted: onSubmitted,
    keyboardType: keyboardType,
    leading: leading,
    trailing: trailing,
    enabled: enabled,
  );
}
