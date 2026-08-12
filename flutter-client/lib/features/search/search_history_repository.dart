import 'package:shared_preferences/shared_preferences.dart';

typedef PreferencesLoader = Future<SharedPreferences> Function();

final class SearchHistoryRepository {
  SearchHistoryRepository({PreferencesLoader? loadPreferences})
    : _loadPreferences = loadPreferences ?? SharedPreferences.getInstance;

  static const storageKey = 'musicfree.search-history.v1';
  static const maxItems = 10;

  final PreferencesLoader _loadPreferences;
  List<String> _items = const [];
  var _loaded = false;

  Future<List<String>> load() async {
    try {
      final preferences = await _loadPreferences();
      _items = _decode(preferences.getStringList(storageKey));
    } on Object {
      _items = const [];
    }
    _loaded = true;
    return List.unmodifiable(_items);
  }

  Future<List<String>> record(String keyword) async {
    await _ensureLoaded();
    final normalized = keyword.trim();
    if (normalized.isEmpty) return List.unmodifiable(_items);
    _items = [
      normalized,
      ..._items.where((item) => item != normalized),
    ].take(maxItems).toList(growable: false);
    await _persistBestEffort();
    return List.unmodifiable(_items);
  }

  Future<List<String>> remove(String keyword) async {
    await _ensureLoaded();
    final normalized = keyword.trim();
    _items = _items.where((item) => item != normalized).toList(growable: false);
    await _persistBestEffort();
    return List.unmodifiable(_items);
  }

  Future<List<String>> clear() async {
    _items = const [];
    _loaded = true;
    await _persistBestEffort();
    return const [];
  }

  Future<void> _ensureLoaded() async {
    if (!_loaded) await load();
  }

  Future<void> _persistBestEffort() async {
    try {
      final preferences = await _loadPreferences();
      await preferences.setStringList(storageKey, _items);
    } on Object {
      // Search remains available when local persistence is unavailable.
    }
  }

  List<String> _decode(List<String>? values) {
    if (values == null) return const [];
    final result = <String>[];
    for (final value in values) {
      final normalized = value.trim();
      if (normalized.isEmpty || result.contains(normalized)) continue;
      result.add(normalized);
      if (result.length == maxItems) break;
    }
    return List.unmodifiable(result);
  }
}
