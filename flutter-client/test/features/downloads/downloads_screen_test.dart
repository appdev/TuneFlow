import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/api/service_origin.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/features/downloads/download_repository.dart';
import 'package:musicfree_service_client/features/downloads/downloads_controller.dart';
import 'package:musicfree_service_client/features/downloads/downloads_screen.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

Widget harness(Widget child) => ShadApp.custom(
  theme: buildLightTheme(),
  appBuilder: (context) => MaterialApp(
    theme: Theme.of(context),
    home: Scaffold(body: ShadAppBuilder(child: child)),
  ),
);

Map<String, Object?> job(String status) => {
  'id': status,
  'status': status,
  'musicInfo': {'id': 'track-$status', 'name': status},
  'quality': '128k',
  'extension': 'mp3',
  'fileName': '$status.mp3',
  'downloaded': 0,
  'total': 10,
  'progress': 0,
  'queuePosition': 1,
  'createdAt': 1000,
  'updatedAt': 1000,
};

void main() {
  testWidgets('download snapshot renders a persisted meta.picUrl cover', (
    tester,
  ) async {
    final value = job('completed');
    value['musicInfo'] = {
      'id': 'covered-track',
      'name': 'Covered track',
      'source': 'tx',
      'meta': {'picUrl': 'https://cdn.example.test/download.jpg'},
    };
    final repository = DownloadRepository(
      ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'data': [value],
            }),
            200,
          ),
        ),
      ),
    );
    final controller = DownloadsController(repository);
    await controller.refresh();

    await tester.pumpWidget(harness(DownloadsScreen(controller: controller)));

    final image = tester.widget<Image>(find.byType(Image).first);
    expect((image.image as NetworkImage).url, contains('download.jpg'));
  });

  testWidgets('waiting job exposes only legal start and delete actions', (
    tester,
  ) async {
    final repository = DownloadRepository(
      ServiceApi(
        ServiceOrigin.parse('http://service.local'),
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'data': [job('waiting')],
            }),
            200,
          ),
        ),
      ),
    );
    final controller = DownloadsController(repository);
    await controller.refresh();

    await tester.pumpWidget(harness(DownloadsScreen(controller: controller)));
    expect(find.byKey(const Key('downloads-route')), findsOneWidget);
    await tester.tap(find.byKey(const Key('download-actions-waiting')));
    await tester.pumpAndSettle();

    expect(find.text('开始'), findsOneWidget);
    expect(find.text('删除'), findsOneWidget);
    expect(find.text('暂停'), findsNothing);
    expect(find.text('继续'), findsNothing);
    expect(find.textContaining('文件夹'), findsNothing);
    expect(find.byKey(const Key('downloads-wide-layout')), findsOneWidget);
  });
}
