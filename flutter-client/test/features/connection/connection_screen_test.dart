import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musicfree_service_client/api/service_api.dart';
import 'package:musicfree_service_client/app/app.dart';
import 'package:musicfree_service_client/features/connection/connection_repository.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../support/memory_app_preferences.dart';

void main() {
  testWidgets('uses the local Service port on macOS', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    try {
      await tester.pumpWidget(
        MusicFreeServiceApp(preferences: MemoryAppPreferences()),
      );
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<ShadInputFormField>(
              find.byKey(const Key('service-origin-field')),
            )
            .controller
            ?.text,
        'http://127.0.0.1:3124',
      );
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('keeps the entered origin visible for an unsupported API', (
    tester,
  ) async {
    final repository = ConnectionRepository(
      (origin) => ServiceApi(
        origin,
        client: MockClient(
          (request) async => http.Response(
            jsonEncode({
              'data': request.url.path.endsWith('health')
                  ? {'status': 'ok'}
                  : {
                      'runtime': 'service',
                      'apiVersion': 'v2',
                      'features': <String, Object?>{},
                    },
            }),
            200,
          ),
        ),
      ),
    );

    await tester.pumpWidget(
      MusicFreeServiceApp(
        connectionRepository: repository,
        preferences: MemoryAppPreferences(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('service-origin-field')),
      'http://service.local',
    );
    await tester.tap(find.byKey(const Key('connect-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('UNSUPPORTED_API_VERSION'), findsOneWidget);
    expect(
      tester
          .widget<ShadInputFormField>(
            find.byKey(const Key('service-origin-field')),
          )
          .controller
          ?.text,
      'http://service.local',
    );
    expect(find.byKey(const Key('connection-route')), findsOneWidget);
  });
}
