import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/app_breakpoints.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/app_states.dart';
import '../../design/components/artwork.dart';
import '../../design/components/playback_progress.dart';
import '../../design/components/queue_panel.dart';
import '../../design/design_tokens.dart';
import 'lyrics_view.dart';
import 'player_controller.dart';
import 'player_state.dart';
import 'wake_lock_port.dart';

final class PlayerScreen extends StatefulWidget {
  const PlayerScreen({
    super.key,
    required this.controller,
    required this.lyricsLoader,
    required this.wakeLock,
    required this.keepAwake,
  });

  final PlayerController controller;
  final Future<Lyrics> Function(Track track) lyricsLoader;
  final WakeLockPort wakeLock;
  final bool keepAwake;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

final class _PlayerScreenState extends State<PlayerScreen> {
  late final PageController pages = PageController(
    initialPage: widget.controller.state.view.index,
  );

  @override
  void initState() {
    super.initState();
    unawaited(widget.wakeLock.setEnabled(widget.keepAwake));
    unawaited(widget.controller.loadLyrics(widget.lyricsLoader));
  }

  @override
  void dispose() {
    pages.dispose();
    unawaited(widget.wakeLock.setEnabled(false));
    super.dispose();
  }

  void _selectView(PlayerView view) {
    widget.controller.setView(view);
    if (pages.hasClients) {
      pages.animateToPage(
        view.index,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    }
  }

  Future<void> _queue() => showAppSheet<void>(
    context,
    title: '播放队列',
    child: ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final state = widget.controller.state;
        return QueuePanel(
          compact: true,
          tracks: state.queue,
          currentIndex: state.currentIndex,
          onSelected: widget.controller.playIndex,
        );
      },
    ),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final state = widget.controller.state;
      final track = state.current;
      if (track == null) {
        return const ColoredBox(
          color: Colors.transparent,
          child: AppEmptyState(message: '播放队列为空'),
        );
      }
      return LayoutBuilder(
        builder: (context, constraints) {
          final mobile =
              classifyLayout(constraints.maxWidth) == AppLayoutClass.mobile;
          final content = mobile
              ? _MobilePlayer(
                  key: const Key('player-mobile-layout'),
                  controller: widget.controller,
                  pages: pages,
                  onViewSelected: _selectView,
                )
              : _DesktopPlayer(
                  key: const Key('player-wide-layout'),
                  controller: widget.controller,
                );
          return ColoredBox(
            key: const Key('player-screen-root'),
            color: AppTokens.of(context).background,
            child: SafeArea(
              child: Column(
                children: [
                  if (state.error != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: AppNotice.error(
                        title: '播放失败',
                        message: state.error.toString(),
                      ),
                    ),
                  Expanded(child: content),
                  _Controls(
                    controller: widget.controller,
                    onQueue: _queue,
                    onLyrics: () =>
                        widget.controller.loadLyrics(widget.lyricsLoader),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

final class _DesktopPlayer extends StatelessWidget {
  const _DesktopPlayer({super.key, required this.controller});
  final PlayerController controller;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    return Padding(
      padding: const EdgeInsets.fromLTRB(38, 30, 38, 18),
      child: Row(
        children: [
          SizedBox(
            width: 450,
            child: Transform.translate(
              offset: const Offset(0, -30),
              child: _DesktopArtworkStage(track: state.current!),
            ),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Center(
              child: SizedBox(
                height: 270,
                child: LyricsView(state: state, verticalPadding: 5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

final class _MobilePlayer extends StatelessWidget {
  const _MobilePlayer({
    super.key,
    required this.controller,
    required this.pages,
    required this.onViewSelected,
  });

  final PlayerController controller;
  final PageController pages;
  final ValueChanged<PlayerView> onViewSelected;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '风从台北来',
                      style: AppTypography.metadata.copyWith(
                        color: AppTokens.of(context).muted,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '正在播放',
                      style: AppTypography.display.copyWith(fontSize: 31),
                    ),
                  ],
                ),
              ),
              ShadButton.ghost(
                width: 44,
                height: 44,
                padding: EdgeInsets.zero,
                onPressed: () {},
                child: const Icon(LucideIcons.ellipsis, size: 20),
              ),
            ],
          ),
        ),
        _ViewTabs(value: state.view, onChanged: onViewSelected),
        Expanded(
          child: PageView(
            controller: pages,
            onPageChanged: (index) =>
                controller.setView(PlayerView.values[index]),
            children: [
              _ArtworkStage(track: state.current!, mobile: true),
              LyricsView(state: state, verticalPadding: 160),
              Padding(
                padding: const EdgeInsets.all(16),
                child: QueuePanel(
                  tracks: state.queue,
                  currentIndex: state.currentIndex,
                  onSelected: controller.playIndex,
                  compact: true,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

final class _ViewTabs extends StatelessWidget {
  const _ViewTabs({required this.value, required this.onChanged});
  final PlayerView value;
  final ValueChanged<PlayerView> onChanged;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final entry in const [
            (PlayerView.artwork, '封面'),
            (PlayerView.lyrics, '歌词'),
            (PlayerView.queue, '队列'),
          ])
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ShadButton.raw(
                key: Key('player-view-${entry.$1.name}'),
                variant: value == entry.$1
                    ? ShadButtonVariant.primary
                    : ShadButtonVariant.outline,
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 15),
                onPressed: () => onChanged(entry.$1),
                child: Text(entry.$2),
              ),
            ),
        ],
      ),
    ),
  );
}

final class _DesktopArtworkStage extends StatelessWidget {
  const _DesktopArtworkStage({required this.track});
  final Track track;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 450),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1.45,
            child: LayoutBuilder(
              builder: (context, constraints) => AppArtwork(
                imageUrl: track.raw['pic'] as String?,
                seed: '${track.source}:${track.id}',
                semanticLabel: '${track.title}封面',
                size: constraints.maxWidth,
                width: constraints.maxWidth,
                height: constraints.maxHeight,
                borderRadius: AppRadii.panel,
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(track.title, style: AppTypography.display),
          const SizedBox(height: 6),
          Text(
            '${track.artist} · ${track.raw['albumName'] ?? track.raw['album'] ?? ''}',
            style: AppTypography.body.copyWith(
              color: AppTokens.of(context).foregroundSecondary,
            ),
          ),
        ],
      ),
    ),
  );
}

final class _ArtworkStage extends StatelessWidget {
  const _ArtworkStage({required this.track, this.mobile = false});
  final Track track;
  final bool mobile;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final limit = mobile ? 300.0 : 430.0;
      final size = math
          .min(
            constraints.maxWidth,
            constraints.maxHeight - (mobile ? 100 : 90),
          )
          .clamp(120.0, limit);
      return Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppArtwork(
                imageUrl: track.raw['pic'] as String?,
                seed: '${track.source}:${track.id}',
                semanticLabel: '${track.title}封面',
                size: size,
                borderRadius: AppRadii.panel,
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                track.title.isEmpty ? track.id : track.title,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: mobile ? AppTypography.section : AppTypography.display,
              ),
              const SizedBox(height: 4),
              Text(
                track.artist,
                textAlign: TextAlign.center,
                style: AppTypography.body.copyWith(
                  color: AppTokens.of(context).foregroundSecondary,
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

final class _Controls extends StatelessWidget {
  const _Controls({
    required this.controller,
    required this.onQueue,
    required this.onLyrics,
  });

  final PlayerController controller;
  final VoidCallback onQueue;
  final VoidCallback onLyrics;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    final mobile = MediaQuery.sizeOf(context).width < 720;
    if (mobile) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              state.current!.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.section,
            ),
            Text(
              '${state.current!.artist} · ${state.quality == 'flac' ? '无损' : state.quality}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.body.copyWith(
                color: AppTokens.of(context).foregroundSecondary,
              ),
            ),
            const SizedBox(height: 16),
            PlaybackProgress(
              position: state.position,
              duration: state.duration,
              onSeek: controller.seek,
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _ControlButton(
                  key: const Key('player-previous'),
                  label: '上一首',
                  icon: LucideIcons.chevronLeft,
                  enabled: state.currentIndex > 0,
                  onPressed: controller.previous,
                ),
                const SizedBox(width: 8),
                _ControlButton(
                  key: const Key('player-play-pause'),
                  label: state.playing ? '暂停' : '播放',
                  icon: state.playing ? LucideIcons.pause : LucideIcons.play,
                  prominent: true,
                  onPressed: state.playing
                      ? controller.pause
                      : controller.resume,
                ),
                const SizedBox(width: 8),
                _ControlButton(
                  key: const Key('player-next'),
                  label: '下一首',
                  icon: LucideIcons.chevronRight,
                  enabled: state.currentIndex + 1 < state.queue.length,
                  onPressed: controller.next,
                ),
              ],
            ),
          ],
        ),
      );
    }
    return Container(
      height: 92,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      decoration: BoxDecoration(
        color: AppTokens.of(context).surface,
        border: Border(
          top: BorderSide(color: AppTokens.of(context).borderSoft),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 300,
            child: Row(
              children: [
                AppArtwork(
                  imageUrl: state.current!.raw['pic'] as String?,
                  seed: '${state.current!.source}:${state.current!.id}',
                  semanticLabel: '${state.current!.title}封面',
                  size: 42,
                  borderRadius: 8,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(state.current!.title, style: AppTypography.title),
                      Text(
                        state.current!.artist,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.metadata.copyWith(
                          color: AppTokens.of(context).foregroundSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _ControlButton(
                      key: const Key('player-previous'),
                      label: '上一首',
                      icon: LucideIcons.chevronLeft,
                      enabled: state.currentIndex > 0,
                      onPressed: controller.previous,
                    ),
                    _ControlButton(
                      key: const Key('player-play-pause'),
                      label: state.playing ? '暂停' : '播放',
                      icon: state.playing
                          ? LucideIcons.pause
                          : LucideIcons.play,
                      prominent: true,
                      onPressed: state.playing
                          ? controller.pause
                          : controller.resume,
                    ),
                    _ControlButton(
                      key: const Key('player-next'),
                      label: '下一首',
                      icon: LucideIcons.chevronRight,
                      enabled: state.currentIndex + 1 < state.queue.length,
                      onPressed: controller.next,
                    ),
                  ],
                ),
                PlaybackProgress(
                  position: state.position,
                  duration: state.duration,
                  compact: true,
                  onSeek: controller.seek,
                ),
              ],
            ),
          ),
          SizedBox(
            width: 250,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                SizedBox(
                  width: 72,
                  child: ShadSelect<String>(
                    initialValue: state.quality,
                    options: const [
                      ShadOption(value: '128k', child: Text('128k')),
                      ShadOption(value: '320k', child: Text('320k')),
                      ShadOption(value: 'flac', child: Text('无损')),
                    ],
                    selectedOptionBuilder: (context, value) => Text(value),
                    onChanged: (value) {
                      if (value != null) controller.setQuality(value);
                    },
                  ),
                ),
                _ControlButton(
                  label: '歌词',
                  icon: LucideIcons.messageSquareText,
                  onPressed: onLyrics,
                ),
                _ControlButton(
                  label: '播放队列',
                  icon: LucideIcons.listMusic,
                  onPressed: onQueue,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

final class _ControlButton extends StatelessWidget {
  const _ControlButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    this.enabled = true,
    this.prominent = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;
  final bool enabled;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final child = prominent
        ? Material(
            color: AppTokens.of(context).foreground,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: enabled ? onPressed : null,
              child: SizedBox.square(
                dimension: 56,
                child: Icon(
                  icon,
                  size: 23,
                  color: AppTokens.of(context).background,
                ),
              ),
            ),
          )
        : ShadButton.raw(
            variant: ShadButtonVariant.ghost,
            width: 48,
            height: 48,
            padding: EdgeInsets.zero,
            enabled: enabled,
            onPressed: enabled ? onPressed : null,
            child: Icon(icon, size: 19),
          );
    return Tooltip(message: label, child: child);
  }
}
