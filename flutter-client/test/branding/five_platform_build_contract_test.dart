import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('CI performs native Windows and Linux Flutter release builds', () {
    final workflow = File(
      '../.github/workflows/flutter-desktop-platforms.yml',
    ).readAsStringSync();

    expect(workflow, contains('runs-on: windows-latest'));
    expect(workflow, contains('flutter build windows --release'));
    expect(workflow, contains('runs-on: ubuntu-latest'));
    expect(workflow, contains('flutter build linux --release'));
    expect(workflow, contains('working-directory: flutter-client'));
  });
}
