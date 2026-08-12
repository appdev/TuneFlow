import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../design/design_tokens.dart';

final class SearchHistoryPanel extends StatelessWidget {
  const SearchHistoryPanel({
    super.key,
    required this.items,
    required this.mobile,
    required this.onSelected,
    required this.onRemoved,
    required this.onCleared,
  });

  final List<String> items;
  final bool mobile;
  final ValueChanged<String> onSelected;
  final ValueChanged<String> onRemoved;
  final VoidCallback onCleared;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return Container(
      key: const Key('search-history-panel'),
      padding: EdgeInsets.fromLTRB(12, mobile ? 10 : 12, 8, 8),
      decoration: BoxDecoration(
        color: mobile ? Colors.transparent : tokens.surface,
        border: mobile ? null : Border.all(color: tokens.border),
        borderRadius: BorderRadius.circular(AppRadii.compactCard),
        boxShadow: mobile ? null : AppShadows.raised,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 34,
            child: Row(
              children: [
                Text('搜索历史', style: AppTypography.title),
                const Spacer(),
                TextButton(
                  key: const Key('search-history-clear'),
                  onPressed: onCleared,
                  child: const Text('清空'),
                ),
              ],
            ),
          ),
          for (var index = 0; index < items.length; index += 1)
            SizedBox(
              height: mobile ? 48 : 44,
              child: Row(
                children: [
                  Expanded(
                    child: TextButton.icon(
                      key: Key('search-history-item-$index'),
                      onPressed: () => onSelected(items[index]),
                      style: TextButton.styleFrom(
                        alignment: Alignment.centerLeft,
                        foregroundColor: tokens.foreground,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      icon: Icon(
                        LucideIcons.history,
                        size: 17,
                        color: tokens.muted,
                      ),
                      label: Text(
                        items[index],
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  IconButton(
                    key: Key('search-history-remove-$index'),
                    tooltip: '删除历史记录',
                    onPressed: () => onRemoved(items[index]),
                    constraints: const BoxConstraints.tightFor(
                      width: 40,
                      height: 40,
                    ),
                    icon: Icon(LucideIcons.x, size: 16, color: tokens.muted),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
