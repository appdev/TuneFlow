import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../design_tokens.dart';

final class AppArtwork extends StatelessWidget {
  const AppArtwork({
    super.key,
    required this.imageUrl,
    required this.seed,
    required this.semanticLabel,
    required this.size,
    this.width,
    this.height,
    this.borderRadius = AppRadii.card,
    this.icon = LucideIcons.music2,
    this.showFallback = true,
  });

  final String? imageUrl;
  final String seed;
  final String semanticLabel;
  final double size;
  final double? width;
  final double? height;
  final double borderRadius;
  final IconData icon;
  final bool showFallback;

  @override
  Widget build(BuildContext context) => Semantics(
    image: true,
    label: semanticLabel,
    child: ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: SizedBox(
        width: width ?? size,
        height: height ?? size,
        child: imageUrl == null || imageUrl!.isEmpty
            ? showFallback
                  ? _ArtworkFallback(seed: seed)
                  : const SizedBox.shrink()
            : Image.network(
                imageUrl!,
                fit: BoxFit.cover,
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
      ),
    ),
  );
}

final class _ArtworkFallback extends StatelessWidget {
  const _ArtworkFallback({required this.seed});

  final String seed;

  @override
  Widget build(BuildContext context) {
    var value = 17;
    for (final unit in seed.codeUnits) {
      value = (value * 31 + unit) & 0x7fffffff;
    }
    final palette = _palette(seed, value);
    return DecoratedBox(
      key: Key('artwork-fallback-$seed'),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: const [0, .55, 1],
          colors: palette,
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: const Alignment(-.44, -.5),
                radius: .42,
                colors: [
                  const Color(0xFFC6EFF9).withValues(alpha: .68),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Color> _palette(String seed, int value) {
    final normalized = seed.toLowerCase();
    if (normalized.contains('wind')) {
      return const [Color(0xFF14323C), Color(0xFF8D4852), Color(0xFFE8A65F)];
    }
    if (normalized.contains('island') || normalized.contains('forest')) {
      return const [Color(0xFF202539), Color(0xFF4F7CA5), Color(0xFFD6B465)];
    }
    if (normalized.contains('city') || normalized.contains('white')) {
      return const [Color(0xFF152A27), Color(0xFF357264), Color(0xFFBC747E)];
    }
    if (normalized.contains('romance') || normalized.contains('sudden')) {
      return const [Color(0xFF352342), Color(0xFF755D9F), Color(0xFFDC7F8D)];
    }
    final hue = (value % 360).toDouble();
    final secondaryHue = (hue + 42 + value % 53) % 360;
    return [
      HSLColor.fromAHSL(1, hue, .32, .2).toColor(),
      HSLColor.fromAHSL(1, hue, .38, .36).toColor(),
      HSLColor.fromAHSL(1, secondaryHue, .52, .58).toColor(),
    ];
  }
}
