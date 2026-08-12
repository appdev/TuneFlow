import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/app_breakpoints.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/artwork.dart';
import '../../design/components/playlist_card.dart';
import '../../design/design_tokens.dart';
import '../player/player_controller.dart';
import 'home_controller.dart';

final class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.controller,
    required this.onSearch,
    required this.onPlaylists,
    required this.onDownloads,
    required this.onSettings,
    this.player,
  });

  final HomeController controller;
  final VoidCallback onSearch;
  final VoidCallback onPlaylists;
  final VoidCallback onDownloads;
  final VoidCallback onSettings;
  final PlayerController? player;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

final class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.controller.state.playlists.isEmpty &&
        widget.controller.state.downloads.isEmpty &&
        widget.controller.state.library.isEmpty) {
      widget.controller.refresh();
    }
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) => LayoutBuilder(
      builder: (context, constraints) {
        final layout = classifyLayout(constraints.maxWidth);
        return ColoredBox(
          color: AppTokens.of(context).background,
          child: layout == AppLayoutClass.mobile
              ? _MobileHome(
                  key: const Key('home-mobile-layout'),
                  state: widget.controller.state,
                  controller: widget.controller,
                  onSearch: widget.onSearch,
                  onPlaylists: widget.onPlaylists,
                  onDownloads: widget.onDownloads,
                  onSettings: widget.onSettings,
                  player: widget.player,
                )
              : _WideHome(
                  key: const Key('home-wide-layout'),
                  state: widget.controller.state,
                  controller: widget.controller,
                  onSearch: widget.onSearch,
                  onPlaylists: widget.onPlaylists,
                  onDownloads: widget.onDownloads,
                  onSettings: widget.onSettings,
                  player: widget.player,
                  showQueue: false,
                ),
        );
      },
    ),
  );
}

final class _WideHome extends StatelessWidget {
  const _WideHome({
    super.key,
    required this.state,
    required this.controller,
    required this.onSearch,
    required this.onPlaylists,
    required this.onDownloads,
    required this.onSettings,
    required this.player,
    required this.showQueue,
  });

  final HomeState state;
  final HomeController controller;
  final VoidCallback onSearch;
  final VoidCallback onPlaylists;
  final VoidCallback onDownloads;
  final VoidCallback onSettings;
  final PlayerController? player;
  final bool showQueue;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    key: const Key('home-screen'),
    padding: const EdgeInsets.fromLTRB(38, 34, 38, 48),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _WideHero(
          state: state,
          controller: controller,
          onSearch: onSearch,
          onPlaylists: onPlaylists,
          onDownloads: onDownloads,
          onSettings: onSettings,
          player: player,
        ),
        if (state.loading) ...[
          const SizedBox(height: AppSpacing.md),
          const LinearProgressIndicator(minHeight: 2),
        ],
        if (state.error != null) ...[
          const SizedBox(height: AppSpacing.md),
          AppNotice.error(
            title: state.stale ? '显示的是上次数据' : '加载失败',
            message: state.error.toString(),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        if (state.lastSyncedAt != null || state.stale)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppTokens.of(context).surface,
              border: Border.all(color: AppTokens.of(context).border),
              borderRadius: BorderRadius.circular(AppRadii.compactCard),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    state.stale ? '部分内容来自缓存；可继续播放已有曲目。' : '音乐数据已与 Service 同步。',
                    style: AppTypography.body.copyWith(
                      color: AppTokens.of(context).foregroundSecondary,
                    ),
                  ),
                ),
                ShadButton.outline(
                  onPressed: controller.refresh,
                  child: const Text('刷新'),
                ),
              ],
            ),
          ),
        const SizedBox(height: AppSpacing.xl),
        _HomeMetrics(state: state),
        const SizedBox(height: AppSpacing.xl),
        _SectionHeader(
          title: _primarySectionTitle(state),
          caption: '',
          onOpen: state.continueListening.isNotEmpty
              ? onPlaylists
              : state.recentlyArrived.isNotEmpty
              ? onDownloads
              : onPlaylists,
        ),
        const SizedBox(height: 14),
        _TrackGallery(
          tracks: _primaryTracks(state),
          onPlay: (track) =>
              player == null ? onPlaylists() : player!.play(track),
          mobile: false,
        ),
        if (state.playlists.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xl),
          _SectionHeader(title: '我的歌单', caption: '', onOpen: onPlaylists),
          const SizedBox(height: 14),
          _PlaylistGallery(
            playlists: state.playlists,
            onOpen: onPlaylists,
            mobile: false,
          ),
        ],
      ],
    ),
  );
}

final class _WideHero extends StatelessWidget {
  const _WideHero({
    required this.state,
    required this.controller,
    required this.onSearch,
    required this.onPlaylists,
    required this.onDownloads,
    required this.onSettings,
    required this.player,
  });

  final HomeState state;
  final HomeController controller;
  final VoidCallback onSearch;
  final VoidCallback onPlaylists;
  final VoidCallback onDownloads;
  final VoidCallback onSettings;
  final PlayerController? player;

  @override
  Widget build(BuildContext context) {
    final track = state.featured.firstOrNull;
    final details = track == null ? '' : _trackDetails(track);
    final tokens = AppTokens.of(context);
    final narrowWindow = MediaQuery.sizeOf(context).width <= 1180;
    return LayoutBuilder(
      builder: (context, constraints) {
        final artWidth = (constraints.maxWidth - 34) * .41;
        return SizedBox(
          height: 310,
          child: Row(
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 28),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '${_greeting(DateTime.now())} · ${state.library.length} 首本地音乐',
                        style: AppTypography.metadata.copyWith(
                          color: tokens.muted,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        track?.title.isNotEmpty == true
                            ? track!.title
                            : '开始听音乐',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: narrowWindow
                            ? AppTypography.display
                            : AppTypography.hero,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        details.isNotEmpty ? details : '搜索歌曲，或从歌单与本地曲库中开始播放。',
                        style: AppTypography.body.copyWith(
                          color: tokens.foregroundSecondary,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          AppButton(
                            onPressed: track == null || player == null
                                ? onPlaylists
                                : () => player!.play(track),
                            leading: const Icon(LucideIcons.play, size: 18),
                            child: const Text('继续播放'),
                          ),
                          AppButton(
                            key: const Key('home-search'),
                            variant: ShadButtonVariant.outline,
                            onPressed: onSearch,
                            child: const Text('搜索音乐'),
                          ),
                          _HiddenShortcut(
                            key: const Key('home-playlists'),
                            onPressed: onPlaylists,
                          ),
                          _HiddenShortcut(
                            key: const Key('home-downloads'),
                            onPressed: onDownloads,
                          ),
                          _HiddenShortcut(
                            key: const Key('home-settings'),
                            onPressed: onSettings,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 34),
              _FeatureArt(
                track: track,
                size: 310,
                width: artWidth,
                height: 310,
              ),
            ],
          ),
        );
      },
    );
  }
}

final class _HiddenShortcut extends StatelessWidget {
  const _HiddenShortcut({super.key, required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Offstage(
    child: SizedBox.square(
      dimension: 48,
      child: Semantics(button: true, child: GestureDetector(onTap: onPressed)),
    ),
  );
}

final class _MobileHome extends StatelessWidget {
  const _MobileHome({
    super.key,
    required this.state,
    required this.controller,
    required this.onSearch,
    required this.onPlaylists,
    required this.onDownloads,
    required this.onSettings,
    required this.player,
  });

  final HomeState state;
  final HomeController controller;
  final VoidCallback onSearch;
  final VoidCallback onPlaylists;
  final VoidCallback onDownloads;
  final VoidCallback onSettings;
  final PlayerController? player;

  @override
  Widget build(BuildContext context) {
    final track = state.featured.firstOrNull;
    return SingleChildScrollView(
      key: const Key('home-screen'),
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _greeting(DateTime.now()),
                      style: AppTypography.metadata,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      track?.title.isNotEmpty == true ? track!.title : '开始听音乐',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.display,
                    ),
                  ],
                ),
              ),
              _IconShortcut(
                key: const Key('home-search'),
                icon: LucideIcons.search,
                label: '搜索',
                onPressed: onSearch,
              ),
            ],
          ),
          if (state.error != null) ...[
            const SizedBox(height: AppSpacing.md),
            AppNotice.error(
              title: state.stale ? '当前显示缓存内容' : '加载失败',
              message: state.error.toString(),
            ),
          ],
          const SizedBox(height: 14),
          if (track != null)
            LayoutBuilder(
              builder: (context, constraints) => _FeatureArt(
                track: track,
                size: constraints.maxWidth / 1.45,
                width: constraints.maxWidth,
                height: constraints.maxWidth / 1.45,
              ),
            )
          else
            _EmptyHero(onSearch: onSearch),
          _HiddenShortcut(
            key: const Key('home-playlists'),
            onPressed: onPlaylists,
          ),
          _HiddenShortcut(
            key: const Key('home-downloads'),
            onPressed: onDownloads,
          ),
          _HiddenShortcut(
            key: const Key('home-settings'),
            onPressed: onSettings,
          ),
          const SizedBox(height: 22),
          _HomeMetrics(state: state, compact: true),
          const SizedBox(height: 22),
          _SectionHeader(
            title: _primarySectionTitle(state),
            caption: '',
            onOpen: state.recentlyArrived.isNotEmpty
                ? onDownloads
                : onPlaylists,
          ),
          const SizedBox(height: 14),
          _TrackGallery(
            tracks: _primaryTracks(state),
            onPlay: (track) =>
                player == null ? onPlaylists() : player!.play(track),
            mobile: true,
          ),
          if (state.playlists.isNotEmpty) ...[
            const SizedBox(height: 22),
            _SectionHeader(title: '我的歌单', caption: '', onOpen: onPlaylists),
            const SizedBox(height: 14),
            _PlaylistGallery(
              playlists: state.playlists,
              onOpen: onPlaylists,
              mobile: true,
            ),
          ],
        ],
      ),
    );
  }
}

String _greeting(DateTime now) => switch (now.hour) {
  < 6 => '夜深了',
  < 11 => '早上好',
  < 14 => '中午好',
  < 18 => '下午好',
  _ => '晚上好',
};

String _trackDetails(Track track) {
  final meta = track.raw['meta'];
  final album = track.raw['albumName'] is String
      ? track.raw['albumName']! as String
      : meta is Map && meta['albumName'] is String
      ? meta['albumName']! as String
      : '';
  return [track.artist, album].where((value) => value.isNotEmpty).join(' · ');
}

List<Track> _primaryTracks(HomeState state) {
  if (state.continueListening.isNotEmpty) return state.continueListening;
  if (state.recentlyArrived.isNotEmpty) return state.recentlyArrived;
  return state.library.map((item) => item.track).toList(growable: false);
}

String _primarySectionTitle(HomeState state) {
  if (state.continueListening.isNotEmpty) return '最近播放';
  if (state.recentlyArrived.isNotEmpty) return '最近下载';
  if (state.library.isNotEmpty) return '本地曲库';
  return '开始探索';
}

final class _EmptyHero extends StatelessWidget {
  const _EmptyHero({required this.onSearch});

  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.all(AppSpacing.lg),
    radius: BorderRadius.circular(AppRadii.card),
    backgroundColor: AppTokens.of(context).surface,
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('还没有播放记录', style: AppTypography.title),
              const SizedBox(height: 4),
              Text(
                '搜索一首歌，首页会展示真实的播放与下载内容。',
                style: AppTypography.metadata.copyWith(
                  color: AppTokens.of(context).foregroundSecondary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        AppButton(
          variant: ShadButtonVariant.outline,
          onPressed: onSearch,
          child: const Text('去搜索'),
        ),
      ],
    ),
  );
}

final class _HomeMetrics extends StatelessWidget {
  const _HomeMetrics({required this.state, this.compact = false});

  final HomeState state;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final completed = state.downloads
        .where((job) => job.status == DownloadStatus.completed)
        .length;
    final items = [
      ('${state.library.length} 首本地音乐', _formatBytes(state.libraryBytes)),
      ('$completed 首已下载', '${state.downloads.length} 个任务'),
      ('${state.playlists.length} 个歌单', '与 Service 保持同步'),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = compact ? 1 : 3;
        final width = columns == 1
            ? constraints.maxWidth
            : (constraints.maxWidth - AppSpacing.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: ShadCard(
                  padding: EdgeInsets.symmetric(
                    horizontal: compact ? 14 : 18,
                    vertical: compact ? 12 : 16,
                  ),
                  radius: BorderRadius.circular(AppRadii.compactCard),
                  backgroundColor: AppTokens.of(context).surface,
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(item.$1, style: AppTypography.title),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        item.$2,
                        style: AppTypography.metadata.copyWith(
                          color: AppTokens.of(context).foregroundSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

String _formatBytes(num value) {
  if (value < 1024) return '${value.toInt()} B';
  if (value < 1024 * 1024) return '${(value / 1024).toStringAsFixed(1)} KB';
  if (value < 1024 * 1024 * 1024) {
    return '${(value / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  return '${(value / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
}

final class _TrackGallery extends StatelessWidget {
  const _TrackGallery({
    required this.tracks,
    required this.onPlay,
    required this.mobile,
  });

  final List<Track> tracks;
  final ValueChanged<Track> onPlay;
  final bool mobile;

  @override
  Widget build(BuildContext context) {
    if (tracks.isEmpty) {
      return Text(
        '暂无可展示的歌曲',
        style: AppTypography.body.copyWith(
          color: AppTokens.of(context).foregroundSecondary,
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = mobile
            ? 1
            : (MediaQuery.sizeOf(context).width > 1180 ? 3 : 2);
        final width =
            (constraints.maxWidth - AppSpacing.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final track in tracks.take(6))
              SizedBox(
                width: width,
                child: _HomeTrackCard(
                  track: track,
                  onPressed: () => onPlay(track),
                ),
              ),
          ],
        );
      },
    );
  }
}

final class _HomeTrackCard extends StatelessWidget {
  const _HomeTrackCard({required this.track, required this.onPressed});

  final Track track;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final picture = track.raw['pic'];
    final hasPicture = picture is String && picture.isNotEmpty;
    return Semantics(
      button: true,
      label: '播放${track.title}',
      child: GestureDetector(
        onTap: onPressed,
        child: ShadCard(
          padding: const EdgeInsets.all(10),
          radius: BorderRadius.circular(AppRadii.compactCard),
          backgroundColor: AppTokens.of(context).surface,
          child: Row(
            children: [
              if (hasPicture) ...[
                AppArtwork(
                  imageUrl: picture,
                  seed: '${track.source}:${track.id}',
                  semanticLabel: '${track.title}封面',
                  size: 56,
                  borderRadius: AppRadii.control,
                  showFallback: false,
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      track.title.isEmpty ? track.id : track.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.title,
                    ),
                    if (_trackDetails(track).isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        _trackDetails(track),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.metadata.copyWith(
                          color: AppTokens.of(context).foregroundSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              const Icon(LucideIcons.play, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

final class _FeatureArt extends StatelessWidget {
  const _FeatureArt({
    required this.track,
    required this.size,
    this.width,
    this.height,
  });
  final Track? track;
  final double size;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) => AppArtwork(
    imageUrl: track?.raw['pic'] as String?,
    seed: track == null ? 'empty-gallery' : '${track!.source}:${track!.id}',
    semanticLabel: track == null ? '暂无推荐封面' : '${track!.title}封面',
    size: size,
    width: width,
    height: height,
    borderRadius: AppRadii.card,
  );
}

final class _PlaylistGallery extends StatelessWidget {
  const _PlaylistGallery({
    required this.playlists,
    required this.onOpen,
    required this.mobile,
  });

  final List<PlaylistSummary> playlists;
  final VoidCallback onOpen;
  final bool mobile;

  @override
  Widget build(BuildContext context) {
    if (playlists.isEmpty) {
      return Text(
        '还没有歌单',
        style: AppTypography.body.copyWith(
          color: AppTokens.of(context).foregroundSecondary,
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = mobile
            ? 2
            : (MediaQuery.sizeOf(context).width > 1180 ? 4 : 3);
        final width =
            (constraints.maxWidth - AppSpacing.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final playlist in playlists)
              SizedBox(
                width: width,
                child: PlaylistCard(
                  playlist: playlist,
                  onPressed: onOpen,
                  variant: PlaylistCardVariant.gallery,
                ),
              ),
          ],
        );
      },
    );
  }
}

final class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.caption,
    required this.onOpen,
  });

  final String title;
  final String caption;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(title, style: AppTypography.section)),
      if (caption.isNotEmpty) ...[
        Text(caption, style: TextStyle(color: AppTokens.of(context).muted)),
        const SizedBox(width: AppSpacing.xs),
      ],
      ShadButton.ghost(
        height: 44,
        onPressed: onOpen,
        child: const Text('查看全部'),
      ),
    ],
  );
}

final class _IconShortcut extends StatelessWidget {
  const _IconShortcut({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: label,
    child: ShadButton.ghost(
      width: 48,
      height: 48,
      padding: EdgeInsets.zero,
      onPressed: onPressed,
      child: Icon(icon, size: 20),
    ),
  );
}
