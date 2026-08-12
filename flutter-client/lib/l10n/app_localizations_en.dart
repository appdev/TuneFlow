// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'TuneFlow';

  @override
  String get connectTitle => 'Connect to TuneFlow Service';

  @override
  String get connectDescription =>
      'Enter the address of the computer running Service. Android Emulator reaches this computer at 10.0.2.2.';

  @override
  String get serviceOrigin => 'Service address';

  @override
  String get connect => 'Connect';

  @override
  String get connecting => 'Connecting…';

  @override
  String get disconnect => 'Disconnect';

  @override
  String get home => 'Home';

  @override
  String get search => 'Search';

  @override
  String get playlists => 'Playlists';

  @override
  String get downloads => 'Downloads';

  @override
  String get settings => 'Settings';

  @override
  String get player => 'Player';

  @override
  String get retry => 'Retry';

  @override
  String get cancel => 'Cancel';

  @override
  String get delete => 'Delete';

  @override
  String get create => 'Create';

  @override
  String get save => 'Save';

  @override
  String get unknownError => 'An unexpected error occurred.';

  @override
  String get desktopTitleHome => 'Home';

  @override
  String get desktopTitleSearch => 'Search';

  @override
  String get desktopTitleSquare => 'Playlist Square';

  @override
  String get desktopTitleCharts => 'Charts';

  @override
  String get desktopTitlePlaylists => 'My Playlists';

  @override
  String get desktopTitleDownloads => 'Downloads';

  @override
  String get desktopTitleSources => 'Sources';

  @override
  String get desktopTitleSettings => 'Settings';

  @override
  String get desktopTitlePlayer => 'Now Playing';

  @override
  String get desktopTitleStates => 'States';
}
