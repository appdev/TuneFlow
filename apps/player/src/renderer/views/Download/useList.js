import { watch } from '@common/utils/vueTools'
import useTrackRowHeight from '@renderer/utils/compositions/useTrackRowHeight'
import useListSelection from '@renderer/utils/compositions/useListSelection'

export default ({ listRef, list }) => {
  const selection = useListSelection(() => list.value, listRef)
  const listItemHeight = useTrackRowHeight()
  watch(() => list.value.map(item => item.id).join('\n'), selection.removeAllSelect)
  return { ...selection, listItemHeight, toggleSelect: selection.toggleSelectData }
}
