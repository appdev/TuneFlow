import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../player/player_controller.dart';
import 'search_track_metadata.dart';

enum TrackActionId {
  playNow,
  playNext,
  enqueue,
  lyrics,
  addToPlaylist,
  download,
}

final class TrackAction {
  const TrackAction({
    required this.id,
    required this.label,
    required this.icon,
    required this.invoke,
    this.enabled = true,
    this.disabledReason,
  });

  final TrackActionId id;
  final String label;
  final IconData icon;
  final Future<void> Function() invoke;
  final bool enabled;
  final String? disabledReason;
}

List<TrackAction> buildTrackActions({
  required Track track,
  required PlayerController player,
  required Future<void> Function(Track) showLyrics,
  required Future<void> Function(Track) addToPlaylist,
  required Future<void> Function(Track, String quality) download,
}) {
  final metadata = SearchTrackMetadata.fromTrack(track);
  return [
    TrackAction(
      id: TrackActionId.playNow,
      label: '立即播放',
      icon: LucideIcons.play,
      invoke: () => player.play(track),
    ),
    TrackAction(
      id: TrackActionId.playNext,
      label: '下一首播放',
      icon: LucideIcons.listStart,
      invoke: () => player.playNext(track),
    ),
    TrackAction(
      id: TrackActionId.enqueue,
      label: '添加到播放队列',
      icon: LucideIcons.listPlus,
      invoke: () async => player.enqueue(track),
    ),
    TrackAction(
      id: TrackActionId.lyrics,
      label: '查看歌词',
      icon: LucideIcons.messageSquareText,
      invoke: () => showLyrics(track),
    ),
    TrackAction(
      id: TrackActionId.addToPlaylist,
      label: '添加到歌单',
      icon: LucideIcons.heartPlus,
      invoke: () => addToPlaylist(track),
    ),
    TrackAction(
      id: TrackActionId.download,
      label: '下载',
      icon: LucideIcons.download,
      invoke: () => download(track, metadata.qualityKey),
    ),
  ];
}
