import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import 'download_repository.dart';

final class DownloadsState {
  const DownloadsState({
    this.jobs = const [],
    this.loading = false,
    this.stale = false,
    this.error,
    this.bytesPerSecond = const {},
    this.lastBulkResult,
  });

  final List<DownloadJob> jobs;
  final bool loading;
  final bool stale;
  final Object? error;
  final Map<String, double> bytesPerSecond;
  final BulkDownloadResult? lastBulkResult;
}

final class DownloadsController extends ChangeNotifier {
  DownloadsController(this.repository);

  final DownloadRepository repository;
  DownloadsState state = const DownloadsState();
  Timer? _refreshTimer;
  DateTime? _sampledAt;
  Map<String, num> _sampledBytes = const {};

  Future<void> refresh() async {
    state = DownloadsState(
      jobs: state.jobs,
      loading: true,
      stale: state.stale,
      error: state.error,
      bytesPerSecond: state.bytesPerSecond,
      lastBulkResult: state.lastBulkResult,
    );
    notifyListeners();
    try {
      final jobs = await repository.list();
      final now = DateTime.now();
      final seconds = _sampledAt == null
          ? 0
          : now.difference(_sampledAt!).inMilliseconds / 1000;
      final speeds = <String, double>{};
      if (seconds > 0) {
        for (final job in jobs.where(
          (job) => job.status == DownloadStatus.running,
        )) {
          final previous = _sampledBytes[job.id];
          if (previous != null && job.downloaded >= previous) {
            speeds[job.id] = (job.downloaded - previous) / seconds;
          }
        }
      }
      _sampledAt = now;
      _sampledBytes = {for (final job in jobs) job.id: job.downloaded};
      state = DownloadsState(jobs: jobs, bytesPerSecond: speeds);
    } on Object catch (error) {
      state = DownloadsState(
        jobs: state.jobs,
        stale: true,
        error: error,
        bytesPerSecond: state.bytesPerSecond,
      );
    }
    notifyListeners();
  }

  Future<void> start(String id) => _mutate(() => repository.start(id));
  Future<void> pause(String id) => _mutate(() => repository.pause(id));
  Future<void> resume(String id) => _mutate(() => repository.resume(id));
  Future<void> delete(String id) => _mutate(() => repository.delete(id));

  Future<BulkDownloadResult> pauseAll() async {
    final running = state.jobs
        .where((job) => job.canPause)
        .toList(growable: false);
    final succeeded = <String>[];
    final failures = <String, Object>{};
    for (final job in running) {
      try {
        await repository.pause(job.id);
        succeeded.add(job.id);
      } on Object catch (error) {
        failures[job.id] = error;
      }
    }
    await refresh();
    final result = BulkDownloadResult(
      succeededIds: List.unmodifiable(succeeded),
      failures: Map.unmodifiable(failures),
    );
    state = DownloadsState(
      jobs: state.jobs,
      loading: state.loading,
      stale: state.stale,
      error: state.error,
      bytesPerSecond: state.bytesPerSecond,
      lastBulkResult: result,
    );
    notifyListeners();
    return result;
  }

  Future<void> _mutate(Future<Object?> Function() action) async {
    await action();
    await refresh();
  }

  void invalidate() {
    state = DownloadsState(
      jobs: state.jobs,
      stale: true,
      error: state.error,
      bytesPerSecond: state.bytesPerSecond,
      lastBulkResult: state.lastBulkResult,
    );
    notifyListeners();
    _refreshTimer ??= Timer(Duration.zero, () {
      _refreshTimer = null;
      refresh();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }
}

final class BulkDownloadResult {
  const BulkDownloadResult({
    required this.succeededIds,
    required this.failures,
  });

  final List<String> succeededIds;
  final Map<String, Object> failures;
  bool get hasFailures => failures.isNotEmpty;
}
