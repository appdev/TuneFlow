// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appTitle => '音流';

  @override
  String get connectTitle => '连接音流服务';

  @override
  String get connectDescription =>
      '输入运行 Service 的电脑地址。Android 模拟器访问本机请使用 10.0.2.2。';

  @override
  String get serviceOrigin => 'Service 地址';

  @override
  String get connect => '连接';

  @override
  String get connecting => '连接中…';

  @override
  String get disconnect => '断开连接';

  @override
  String get home => '首页';

  @override
  String get search => '搜索';

  @override
  String get playlists => '歌单';

  @override
  String get downloads => '下载';

  @override
  String get settings => '设置';

  @override
  String get player => '播放器';

  @override
  String get retry => '重试';

  @override
  String get cancel => '取消';

  @override
  String get delete => '删除';

  @override
  String get create => '创建';

  @override
  String get save => '保存';

  @override
  String get unknownError => '发生了未知错误。';

  @override
  String get desktopTitleHome => '首页';

  @override
  String get desktopTitleSearch => '搜索';

  @override
  String get desktopTitleSquare => '歌单广场';

  @override
  String get desktopTitleCharts => '排行榜';

  @override
  String get desktopTitlePlaylists => '我的歌单';

  @override
  String get desktopTitleDownloads => '下载管理';

  @override
  String get desktopTitleSources => '音源管理';

  @override
  String get desktopTitleSettings => '设置';

  @override
  String get desktopTitlePlayer => '正在播放';

  @override
  String get desktopTitleStates => '状态演示';
}
