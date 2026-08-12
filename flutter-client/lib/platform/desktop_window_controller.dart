import 'package:flutter/foundation.dart';
import 'package:window_manager/window_manager.dart';

abstract interface class WindowOperations {
  Future<void> minimize();
  Future<void> maximize();
  Future<void> unmaximize();
  Future<void> close();
  Future<void> startDragging();
  Future<bool> isMaximized();
}

final class WindowManagerOperations implements WindowOperations {
  const WindowManagerOperations();

  @override
  Future<void> close() => windowManager.close();

  @override
  Future<bool> isMaximized() => windowManager.isMaximized();

  @override
  Future<void> maximize() => windowManager.maximize();

  @override
  Future<void> minimize() => windowManager.minimize();

  @override
  Future<void> startDragging() => windowManager.startDragging();

  @override
  Future<void> unmaximize() => windowManager.unmaximize();
}

final class DesktopWindowController with WindowListener {
  DesktopWindowController(this._operations);

  final WindowOperations _operations;
  final ValueNotifier<bool> maximized = ValueNotifier(false);
  bool _attached = false;

  Future<void> minimize() => _operations.minimize();

  Future<void> close() => _operations.close();

  Future<void> startDragging() => _operations.startDragging();

  Future<void> toggleMaximize() async {
    final currentlyMaximized = await _operations.isMaximized();
    if (currentlyMaximized) {
      await _operations.unmaximize();
      maximized.value = false;
    } else {
      await _operations.maximize();
      maximized.value = true;
    }
  }

  Future<void> attach() async {
    if (_attached) return;
    _attached = true;
    windowManager.addListener(this);
    maximized.value = await _operations.isMaximized();
  }

  void detach() {
    if (!_attached) return;
    windowManager.removeListener(this);
    _attached = false;
  }

  @override
  void onWindowMaximize() => maximized.value = true;

  @override
  void onWindowUnmaximize() => maximized.value = false;
}

final desktopWindowController = DesktopWindowController(
  const WindowManagerOperations(),
);
