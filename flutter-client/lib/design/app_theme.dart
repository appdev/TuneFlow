import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'design_tokens.dart';

ShadThemeData buildLightTheme() => ShadThemeData(
  brightness: Brightness.light,
  colorScheme: _lightScheme,
  textTheme: ShadTextTheme(family: AppTypography.fontFamily),
  radius: const BorderRadius.all(Radius.circular(AppRadii.control)),
  breakpoints: ShadBreakpoints(sm: 720, md: 900, lg: 1180),
);

final _lightScheme = ShadZincColorScheme.light(
  background: AppTokens.light.background,
  foreground: AppTokens.light.foreground,
  card: AppTokens.light.surface,
  cardForeground: AppTokens.light.foreground,
  popover: AppTokens.light.surface,
  popoverForeground: AppTokens.light.foreground,
  primary: AppTokens.light.accent,
  primaryForeground: AppTokens.light.accentForeground,
  secondary: AppTokens.light.surfaceWarm,
  secondaryForeground: AppTokens.light.foreground,
  muted: AppTokens.light.surfaceWarm,
  mutedForeground: AppTokens.light.muted,
  accent: AppTokens.light.surfaceWarm,
  accentForeground: AppTokens.light.foreground,
  destructive: AppTokens.light.danger,
  border: AppTokens.light.border,
  input: AppTokens.light.border,
  ring: AppTokens.light.focusRing,
);

ShadThemeData buildDarkTheme() => ShadThemeData(
  brightness: Brightness.dark,
  colorScheme: _darkScheme,
  textTheme: ShadTextTheme(family: AppTypography.fontFamily),
  radius: const BorderRadius.all(Radius.circular(AppRadii.control)),
  breakpoints: ShadBreakpoints(sm: 720, md: 900, lg: 1180),
);

final _darkScheme = ShadZincColorScheme.dark(
  background: AppTokens.dark.background,
  foreground: AppTokens.dark.foreground,
  card: AppTokens.dark.surface,
  cardForeground: AppTokens.dark.foreground,
  popover: AppTokens.dark.surface,
  popoverForeground: AppTokens.dark.foreground,
  primary: AppTokens.dark.accent,
  primaryForeground: AppTokens.dark.accentForeground,
  secondary: AppTokens.dark.surfaceWarm,
  secondaryForeground: AppTokens.dark.foreground,
  muted: AppTokens.dark.surfaceWarm,
  mutedForeground: AppTokens.dark.muted,
  accent: AppTokens.dark.surfaceWarm,
  accentForeground: AppTokens.dark.foreground,
  destructive: AppTokens.dark.danger,
  border: AppTokens.dark.border,
  input: AppTokens.dark.border,
  ring: AppTokens.dark.focusRing,
);
