import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/features/search/search_history_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.resetStatic();
    SharedPreferences.setMockInitialValues({});
  });

  test(
    'normalizes, deduplicates, and persists newest searches first',
    () async {
      final repository = SearchHistoryRepository();

      expect(await repository.record('  晚风  '), ['晚风']);
      expect(await repository.record('挪威的森林'), ['挪威的森林', '晚风']);
      expect(await repository.record('晚风'), ['晚风', '挪威的森林']);
      expect(await repository.record('   '), ['晚风', '挪威的森林']);

      expect(await SearchHistoryRepository().load(), ['晚风', '挪威的森林']);
    },
  );

  test('keeps only the ten most recent searches', () async {
    final repository = SearchHistoryRepository();

    for (var index = 0; index < 12; index += 1) {
      await repository.record('关键词$index');
    }

    final items = await repository.load();
    expect(items, hasLength(10));
    expect(items.first, '关键词11');
    expect(items.last, '关键词2');
  });

  test('removes one search and clears all searches', () async {
    SharedPreferences.resetStatic();
    SharedPreferences.setMockInitialValues({
      SearchHistoryRepository.storageKey: ['晚风', '挪威的森林'],
    });
    final preferences = await SharedPreferences.getInstance();
    expect(preferences.getStringList(SearchHistoryRepository.storageKey), [
      '晚风',
      '挪威的森林',
    ]);
    final repository = SearchHistoryRepository(
      loadPreferences: () async => preferences,
    );

    expect(await repository.remove(' 晚风 '), ['挪威的森林']);
    expect(await repository.clear(), isEmpty);
    expect(await SearchHistoryRepository().load(), isEmpty);
  });
}
