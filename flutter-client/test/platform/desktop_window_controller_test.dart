import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/platform/desktop_window_controller.dart';

void main() {
  test('delegates minimize, close, and dragging', () async {
    final operations = _FakeWindowOperations();
    final controller = DesktopWindowController(operations);

    await controller.minimize();
    await controller.close();
    await controller.startDragging();

    expect(operations.calls, ['minimize', 'close', 'startDragging']);
  });

  test('maximizes a restored window', () async {
    final operations = _FakeWindowOperations(maximized: false);
    final controller = DesktopWindowController(operations);

    await controller.toggleMaximize();

    expect(operations.calls, ['isMaximized', 'maximize']);
    expect(controller.maximized.value, isTrue);
  });

  test('restores a maximized window', () async {
    final operations = _FakeWindowOperations(maximized: true);
    final controller = DesktopWindowController(operations);

    await controller.toggleMaximize();

    expect(operations.calls, ['isMaximized', 'unmaximize']);
    expect(controller.maximized.value, isFalse);
  });

  test('tracks native maximize and restore events', () {
    final controller = DesktopWindowController(_FakeWindowOperations());

    controller.onWindowMaximize();
    expect(controller.maximized.value, isTrue);

    controller.onWindowUnmaximize();
    expect(controller.maximized.value, isFalse);
  });
}

final class _FakeWindowOperations implements WindowOperations {
  _FakeWindowOperations({this.maximized = false});

  bool maximized;
  final calls = <String>[];

  @override
  Future<void> close() async => calls.add('close');

  @override
  Future<bool> isMaximized() async {
    calls.add('isMaximized');
    return maximized;
  }

  @override
  Future<void> maximize() async {
    maximized = true;
    calls.add('maximize');
  }

  @override
  Future<void> minimize() async => calls.add('minimize');

  @override
  Future<void> startDragging() async => calls.add('startDragging');

  @override
  Future<void> unmaximize() async {
    maximized = false;
    calls.add('unmaximize');
  }
}
