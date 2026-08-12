import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// Semantic visual roles translated from the accepted Open Design project.
@immutable
final class AppTokens {
  const AppTokens({
    required this.background,
    required this.surface,
    required this.surfaceWarm,
    required this.foreground,
    required this.foregroundSecondary,
    required this.muted,
    required this.border,
    required this.borderSoft,
    required this.accent,
    required this.accentForeground,
    required this.success,
    required this.warning,
    required this.danger,
    required this.focusRing,
    required this.overlay,
  });

  static const light = AppTokens(
    background: Color(0xFFEDF3F6),
    surface: Color(0xFFFFFFFF),
    surfaceWarm: Color(0xFFE6EEF2),
    foreground: Color(0xFF111A20),
    foregroundSecondary: Color(0xFF44535E),
    muted: Color(0xFF6D7B85),
    border: Color(0xFFCEDAE0),
    borderSoft: Color(0xFFE0E8EC),
    accent: Color(0xFF356B7C),
    accentForeground: Color(0xFFF7FCFE),
    success: Color(0xFF2C8C63),
    warning: Color(0xFFA86D24),
    danger: Color(0xFFB94E4E),
    focusRing: Color(0xFF4D8090),
    overlay: Color(0x66111A20),
  );

  static const dark = AppTokens(
    background: Color(0xFF05090D),
    surface: Color(0xFF0B1118),
    surfaceWarm: Color(0xFF182432),
    foreground: Color(0xFFF3F7FA),
    foregroundSecondary: Color(0xFFB7C3CD),
    muted: Color(0xFF7F8D99),
    border: Color(0xFF26333D),
    borderSoft: Color(0xFF1B2730),
    accent: Color(0xFFA8D5E5),
    accentForeground: Color(0xFF071219),
    success: Color(0xFF5ED39A),
    warning: Color(0xFFE3B35C),
    danger: Color(0xFFF17878),
    focusRing: Color(0xFFD5F1FA),
    overlay: Color(0xB3000000),
  );

  static AppTokens of(BuildContext context) =>
      ShadTheme.of(context).brightness == Brightness.dark ? dark : light;

  final Color background;
  final Color surface;
  final Color surfaceWarm;
  final Color foreground;
  final Color foregroundSecondary;
  final Color muted;
  final Color border;
  final Color borderSoft;
  final Color accent;
  final Color accentForeground;
  final Color success;
  final Color warning;
  final Color danger;
  final Color focusRing;
  final Color overlay;
}

abstract final class AppSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double section = 64;
}

abstract final class AppRadii {
  static const double control = 8;
  static const double compactCard = 12;
  static const double card = 18;
  static const double panel = 24;
  static const double sheet = 28;
  static const double pill = 999;
}

abstract final class AppShadows {
  static const panel = <BoxShadow>[
    BoxShadow(color: Color(0x14000000), blurRadius: 24, offset: Offset(0, 10)),
  ];
  static const raised = <BoxShadow>[
    BoxShadow(color: Color(0x30000000), blurRadius: 42, offset: Offset(0, 18)),
  ];
}

abstract final class AppTypography {
  static const String fontFamily = 'NotoSansCJKsc';
  static const hero = TextStyle(
    fontFamily: fontFamily,
    fontSize: 62,
    height: 1.02,
    fontWeight: FontWeight.w700,
    letterSpacing: -2.4,
  );
  static const display = TextStyle(
    fontFamily: fontFamily,
    fontSize: 40,
    height: 1.08,
    fontWeight: FontWeight.w700,
    letterSpacing: -1.2,
  );
  static const section = TextStyle(
    fontFamily: fontFamily,
    fontSize: 22,
    height: 1.2,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.4,
  );
  static const title = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
    height: 1.3,
    fontWeight: FontWeight.w600,
  );
  static const body = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    height: 1.5,
  );
  static const metadata = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    height: 1.35,
    fontWeight: FontWeight.w500,
  );
  static const counter = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    height: 1.35,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}
