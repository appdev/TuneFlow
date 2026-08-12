import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android exposes localized TuneFlow app names', () {
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    final en = File(
      'android/app/src/main/res/values/strings.xml',
    ).readAsStringSync();
    final zh = File(
      'android/app/src/main/res/values-zh-rCN/strings.xml',
    ).readAsStringSync();

    expect(manifest, contains('android:label="@string/app_name"'));
    expect(en, contains('<string name="app_name">TuneFlow</string>'));
    expect(zh, contains('<string name="app_name">音流</string>'));
  });

  test('iOS exposes localized TuneFlow app names', () {
    final info = File('ios/Runner/Info.plist').readAsStringSync();
    final project = File(
      'ios/Runner.xcodeproj/project.pbxproj',
    ).readAsStringSync();

    expect(
      File('ios/Runner/en.lproj/InfoPlist.strings').readAsStringSync(),
      contains('"TuneFlow"'),
    );
    expect(
      File('ios/Runner/zh-Hans.lproj/InfoPlist.strings').readAsStringSync(),
      contains('"音流"'),
    );
    expect(info, contains('<string>TuneFlow</string>'));
    expect(project, contains('InfoPlist.strings'));
    expect(
      project,
      contains(
        '97C146EC1CF9000F007C117D /* Resources */ = {\n'
        '\t\t\tisa = PBXResourcesBuildPhase;\n'
        '\t\t\tbuildActionMask = 2147483647;\n'
        '\t\t\tfiles = (\n'
        '\t\t\t\tA10000000000000000000001 /* InfoPlist.strings in Resources */,',
      ),
    );
  });

  test('macOS builds TuneFlow.app with localized names', () {
    final appInfo = File(
      'macos/Runner/Configs/AppInfo.xcconfig',
    ).readAsStringSync();
    final scheme = File(
      'macos/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme',
    ).readAsStringSync();

    expect(appInfo, contains('PRODUCT_NAME = TuneFlow'));
    expect(
      File('macos/Runner/en.lproj/InfoPlist.strings').readAsStringSync(),
      contains('"TuneFlow"'),
    );
    expect(
      File('macos/Runner/zh-Hans.lproj/InfoPlist.strings').readAsStringSync(),
      contains('"音流"'),
    );
    expect(scheme, contains('BuildableName = "TuneFlow.app"'));
    final project = File(
      'macos/Runner.xcodeproj/project.pbxproj',
    ).readAsStringSync();
    expect(
      project,
      contains(
        '33CC10EB2044A3C60003C045 /* Resources */ = {\n'
        '\t\t\tisa = PBXResourcesBuildPhase;\n'
        '\t\t\tbuildActionMask = 2147483647;\n'
        '\t\t\tfiles = (\n'
        '\t\t\t\tA20000000000000000000001 /* InfoPlist.strings in Resources */,',
      ),
    );
    final window = File(
      'macos/Runner/MainFlutterWindow.swift',
    ).readAsStringSync();
    expect(window, isNot(contains('musicfree/window')));
    expect(window, isNot(contains('isHidden = true')));
  });

  test('Windows exposes TuneFlow product metadata and icon', () {
    final resources = File('windows/runner/Runner.rc').readAsStringSync();
    final runner = File('windows/runner/main.cpp').readAsStringSync();

    expect(resources, contains('VALUE "FileDescription", "TuneFlow"'));
    expect(resources, contains('VALUE "ProductName", "TuneFlow"'));
    expect(runner, contains('window.Create(L"TuneFlow"'));
    expect(File('windows/runner/resources/app_icon.ico').existsSync(), isTrue);
  });

  test('Linux exposes TuneFlow title, stable ID, and embedded icon', () {
    final application = File(
      'linux/runner/my_application.cc',
    ).readAsStringSync();
    final cmake = File('linux/CMakeLists.txt').readAsStringSync();

    expect(application, contains('gtk_window_set_title(window, "TuneFlow")'));
    expect(application, contains('gdk_pixbuf_new_from_resource'));
    expect(
      cmake,
      contains('set(APPLICATION_ID "com.musicfree.serviceclient")'),
    );
    expect(File('linux/runner/resources/tuneflow.png').existsSync(), isTrue);
  });

  test('exactly the five supported platform directories are present', () {
    for (final name in ['android', 'ios', 'macos', 'windows', 'linux']) {
      expect(Directory(name).existsSync(), isTrue, reason: '$name is required');
    }
    expect(Directory('web').existsSync(), isFalse);
  });

  test('AppIcon catalogs reference existing files', () {
    for (final directory in [
      Directory('ios/Runner/Assets.xcassets/AppIcon.appiconset'),
      Directory('macos/Runner/Assets.xcassets/AppIcon.appiconset'),
    ]) {
      final contents =
          jsonDecode(File('${directory.path}/Contents.json').readAsStringSync())
              as Map<String, Object?>;
      final images = contents['images']! as List<Object?>;
      for (final image in images.cast<Map<String, Object?>>()) {
        final filename = image['filename'] as String?;
        if (filename != null) {
          expect(
            File('${directory.path}/$filename').existsSync(),
            isTrue,
            reason: '$filename must exist in ${directory.path}',
          );
        }
      }
    }
  });
}
