import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/design/app_theme.dart';
import 'package:musicfree_service_client/design/design_tokens.dart';
import 'package:musicfree_service_client/design/app_breakpoints.dart';
import 'package:musicfree_service_client/design/components/app_navigation.dart';
import 'package:musicfree_service_client/design/components/artwork.dart';
import 'package:musicfree_service_client/design/components/app_button.dart';
import 'package:musicfree_service_client/design/components/app_feedback.dart';
import 'package:musicfree_service_client/design/components/app_form.dart';
import 'package:musicfree_service_client/design/components/app_states.dart';
import 'package:musicfree_service_client/design/components/queue_panel.dart';
import 'package:musicfree_service_client/design/components/track_tile.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/l10n/app_localizations.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

void main() {
  test('typography uses the bundled Chinese UI font', () {
    expect(AppTypography.fontFamily, 'NotoSansCJKsc');
  });

  Track track(String id) => Track.fromJson({
    'id': id,
    'name': '歌曲$id',
    'singer': '歌手$id',
    'source': 'kw',
  });

  testWidgets('AppButton keeps a 48dp interactive target', (tester) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: Center(
            child: AppButton(
              key: const Key('action'),
              onPressed: () {},
              child: const Text('连接'),
            ),
          ),
        ),
      ),
    );

    expect(
      tester.getSize(find.byKey(const Key('action'))).height,
      greaterThanOrEqualTo(48),
    );
  });

  testWidgets('desktop navigation renders the localized TuneFlow brand', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ShadApp.custom(
        theme: buildLightTheme(),
        appBuilder: (context) => MaterialApp(
          theme: Theme.of(context),
          locale: const Locale('en'),
          localizationsDelegates: const [AppLocalizations.delegate],
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: AppDesktopNavigation(
              destinations: const [
                AppDestination(id: 'home', label: 'Home', icon: Icons.home),
              ],
              selectedId: 'home',
              onSelected: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('brand-logo')), findsOneWidget);
    expect(find.byKey(const Key('brand-wordmark')), findsOneWidget);
    expect(find.text('TuneFlow'), findsOneWidget);
    expect(
      tester.widget<Image>(find.byKey(const Key('brand-logo'))).image,
      const AssetImage('assets/branding/TuneFlow.png'),
    );
  });

  testWidgets('loading AppButton disables repeated activation', (tester) async {
    var presses = 0;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: AppButton(
            loading: true,
            onPressed: () => presses++,
            child: const Text('保存'),
          ),
        ),
      ),
    );

    expect(tester.widget<ShadButton>(find.byType(ShadButton)).enabled, isFalse);
    expect(presses, 0);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('AppTextField forwards edited values', (tester) async {
    var value = '';
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: AppTextField(
            key: const Key('field'),
            placeholder: 'Service 地址',
            onChanged: (next) => value = next,
          ),
        ),
      ),
    );

    await tester.enterText(find.byKey(const Key('field')), 'http://service');
    expect(value, 'http://service');
  });

  testWidgets('AppNotice exposes destructive errors persistently', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: const Scaffold(
          body: AppNotice.error(title: '连接失败', message: 'NETWORK_ERROR'),
        ),
      ),
    );

    expect(find.text('连接失败'), findsOneWidget);
    expect(find.text('NETWORK_ERROR'), findsOneWidget);
    expect(
      tester.widget<ShadAlert>(find.byType(ShadAlert)).variant,
      ShadAlertVariant.destructive,
    );
  });

  testWidgets('AppRetryState invokes retry from an empty-safe surface', (
    tester,
  ) async {
    var retries = 0;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: AppRetryState(
            message: '暂时无法加载',
            retryLabel: '重试',
            onRetry: () => retries++,
          ),
        ),
      ),
    );

    await tester.tap(find.text('重试'));
    expect(retries, 1);
  });

  testWidgets('destructive dialog returns only the confirmed result', (
    tester,
  ) async {
    late BuildContext context;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Builder(
          builder: (value) {
            context = value;
            return const SizedBox();
          },
        ),
      ),
    );

    final result = showAppDestructiveDialog(
      context,
      title: '删除歌单？',
      message: '此操作不可撤销',
      cancelLabel: '取消',
      confirmLabel: '删除',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除'));
    await tester.pumpAndSettle();
    expect(await result, isTrue);
  });

  testWidgets('showAppMessage displays transient Sonner feedback', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        builder: (context, child) => ShadAppBuilder(child: child!),
        home: Builder(
          builder: (context) => AppButton(
            onPressed: () =>
                showAppMessage(context, title: '已保存', message: '设置已更新'),
            child: const Text('触发'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('触发'));
    await tester.pump();
    expect(find.text('已保存'), findsOneWidget);
    expect(find.text('设置已更新'), findsOneWidget);
  });

  testWidgets('showAppSheet uses a bottom Shad sheet', (tester) async {
    late BuildContext context;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Builder(
          builder: (value) {
            context = value;
            return const SizedBox();
          },
        ),
      ),
    );

    showAppSheet<void>(context, title: '歌曲操作', child: const Text('加入歌单'));
    await tester.pumpAndSettle();
    expect(find.byType(ShadSheet), findsOneWidget);
    expect(find.text('加入歌单'), findsOneWidget);
  });

  test('app layout changes at the accepted mobile boundary', () {
    expect(appLayoutForWidth(719), AppLayout.phone);
    expect(appLayoutForWidth(720), AppLayout.tablet);
  });

  testWidgets('artwork fallback is deterministic and semantically labeled', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: const AppArtwork(
          imageUrl: null,
          seed: 'kw:42',
          semanticLabel: '晚风封面',
          size: 120,
        ),
      ),
    );

    expect(find.bySemanticsLabel('晚风封面'), findsOneWidget);
    expect(find.byKey(const Key('artwork-fallback-kw:42')), findsOneWidget);
  });

  testWidgets('track without a picture does not render generated artwork', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: TrackTile(
            track: track('no-cover'),
            onPlay: () {},
            onActions: () {},
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('artwork-fallback-kw:no-cover')), findsNothing);
    expect(find.byKey(const Key('play-track-no-cover')), findsOneWidget);
  });

  testWidgets('failed network artwork is not replaced by generated artwork', (
    tester,
  ) async {
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: const AppArtwork(
          imageUrl: 'https://invalid.example.test/missing.jpg',
          seed: 'failed-cover',
          semanticLabel: '失败封面',
          size: 52,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('artwork-fallback-failed-cover')),
      findsNothing,
    );
  });

  testWidgets('queue panel selects the requested queue index', (tester) async {
    var selected = -1;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: Scaffold(
          body: QueuePanel(
            tracks: [track('a'), track('b')],
            currentIndex: 0,
            onSelected: (index) => selected = index,
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('queue-track-b')));
    expect(selected, 1);
  });

  testWidgets('mobile navigation reports the selected destination', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      ShadApp(
        theme: buildLightTheme(),
        home: AppMobileNavigation(
          destinations: const [
            AppDestination(id: 'home', label: '首页', icon: Icons.home),
            AppDestination(id: 'search', label: '搜索', icon: Icons.search),
          ],
          selectedId: 'home',
          onSelected: (value) => selected = value,
        ),
      ),
    );

    await tester.tap(find.text('搜索'));
    expect(selected, 'search');
  });
}
