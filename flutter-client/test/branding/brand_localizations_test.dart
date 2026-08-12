import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/l10n/app_localizations_en.dart';
import 'package:musicfree_service_client/l10n/app_localizations_zh.dart';

void main() {
  test('brand names are localized without changing technical identifiers', () {
    final en = AppLocalizationsEn();
    final zh = AppLocalizationsZh();

    expect(en.appTitle, 'TuneFlow');
    expect(en.connectTitle, 'Connect to TuneFlow Service');
    expect(en.desktopTitleSearch, 'Search');
    expect(zh.appTitle, '音流');
    expect(zh.connectTitle, '连接音流服务');
    expect(zh.desktopTitleSearch, '搜索');
  });
}
