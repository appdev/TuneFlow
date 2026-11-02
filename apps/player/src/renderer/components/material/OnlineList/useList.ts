import { watch, type Ref } from '@common/utils/vueTools'
import useTrackRowHeight from '@renderer/utils/compositions/useTrackRowHeight'
import useListSelection from '@renderer/utils/compositions/useListSelection'

export default ({ listRef, props }: { listRef: Ref<any>, props: { list: LX.Music.MusicInfoOnline[], comfortable?: boolean } }) => {
  const selection = useListSelection(() => props.list, listRef)
  const listItemHeight = useTrackRowHeight()
  watch(() => props.list, selection.removeAllSelect)
  return { ...selection, listItemHeight }
}
