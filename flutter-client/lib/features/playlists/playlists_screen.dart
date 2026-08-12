import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/app_form.dart';
import '../../design/components/app_states.dart';
import '../../design/components/playlist_card.dart';
import '../../design/app_breakpoints.dart';
import '../../design/design_tokens.dart';
import 'playlists_controller.dart';

final class PlaylistsScreen extends StatefulWidget {
  const PlaylistsScreen({
    super.key,
    required this.controller,
    required this.onOpen,
  });

  final PlaylistsController controller;
  final ValueChanged<String> onOpen;

  @override
  State<PlaylistsScreen> createState() => _PlaylistsScreenState();
}

final class _PlaylistsScreenState extends State<PlaylistsScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.controller.state.items.isEmpty) widget.controller.refresh();
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = TextEditingController();
    String? validation;
    final accepted = await showShadDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => ShadDialog(
          title: const Text('新建歌单'),
          description: const Text('歌单将保存在当前 Service。'),
          actions: [
            AppButton(
              variant: ShadButtonVariant.outline,
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            AppButton(
              onPressed: () {
                if (name.text.trim().isEmpty) {
                  setDialogState(() => validation = '请输入歌单名称');
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: const Text('创建'),
            ),
          ],
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppTextField(
                key: const Key('playlist-name-field'),
                controller: name,
                placeholder: '歌单名称',
              ),
              if (validation != null) ...[
                const SizedBox(height: 8),
                Text(validation!, style: const TextStyle(color: Colors.red)),
              ],
            ],
          ),
        ),
      ),
    );
    final value = name.text.trim();
    name.dispose();
    if (accepted != true || value.isEmpty) return;
    try {
      await widget.controller.create(name: value);
    } on Object catch (error) {
      if (mounted) {
        showAppMessage(
          context,
          title: '创建失败',
          message: error.toString(),
          destructive: true,
        );
      }
    }
  }

  Future<void> _delete(String id, String name) async {
    final accepted = await showAppDestructiveDialog(
      context,
      title: '删除歌单？',
      message: '“$name”将从 Service 中删除。',
      cancelLabel: '取消',
      confirmLabel: '删除',
    );
    if (accepted) await widget.controller.delete(id);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final state = widget.controller.state;
      return LayoutBuilder(
        builder: (context, constraints) {
          final mobile =
              classifyLayout(constraints.maxWidth) == AppLayoutClass.mobile;
          return ColoredBox(
            key: Key(
              mobile ? 'playlists-gallery-mobile' : 'playlists-gallery-wide',
            ),
            color: AppTokens.of(context).background,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                mobile ? 16 : 38,
                mobile ? 20 : 34,
                mobile ? 16 : 38,
                0,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              '当前 Service',
                              style: AppTypography.metadata,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              mobile ? '我的音乐' : '我的歌单',
                              style: mobile
                                  ? AppTypography.display.copyWith(fontSize: 31)
                                  : AppTypography.display,
                            ),
                          ],
                        ),
                      ),
                      AppButton(
                        key: const Key('create-playlist'),
                        onPressed: _create,
                        leading: const Icon(LucideIcons.plus, size: 18),
                        child: const Text('新建歌单'),
                      ),
                    ],
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
                  Expanded(
                    child: !state.loading && state.items.isEmpty
                        ? const AppEmptyState(message: '还没有歌单')
                        : GridView.builder(
                            key: const Key('playlists-screen'),
                            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: mobile
                                  ? 2
                                  : (constraints.maxWidth / 270).floor().clamp(
                                      2,
                                      5,
                                    ),
                              crossAxisSpacing: AppSpacing.md,
                              mainAxisSpacing: AppSpacing.md,
                              // Artwork is square and the two metadata rows need
                              // another 64 px. Keep enough vertical room at both
                              // reference widths instead of clipping the card.
                              childAspectRatio: mobile ? .76 : .84,
                            ),
                            itemCount: state.items.length,
                            itemBuilder: (context, index) {
                              final playlist = state.items[index];
                              final picture = playlist.tracks
                                  .map((track) => track.raw['pic'])
                                  .whereType<String>()
                                  .firstOrNull;
                              return PlaylistCard(
                                key: Key('playlist-${playlist.id}'),
                                playlist: playlist,
                                imageUrl: picture == null
                                    ? null
                                    : Uri.tryParse(picture),
                                variant: PlaylistCardVariant.gallery,
                                onPressed: () => widget.onOpen(playlist.id),
                                onDelete: playlist.isBuiltIn
                                    ? null
                                    : () => _delete(
                                        playlist.id,
                                        playlist.displayName,
                                      ),
                              );
                            },
                          ),
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
