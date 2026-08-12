import 'package:wakelock_plus/wakelock_plus.dart';

abstract interface class WakeLockPort {
  Future<void> setEnabled(bool value);
}

final class SystemWakeLock implements WakeLockPort {
  const SystemWakeLock();

  @override
  Future<void> setEnabled(bool value) => WakelockPlus.toggle(enable: value);
}
