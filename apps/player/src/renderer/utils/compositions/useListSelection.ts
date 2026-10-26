import { ref, shallowRef, onBeforeUnmount, type Ref } from '@common/utils/vueTools'

// 多选模式独立于选中数量：反选或取消最后一首后，仍可继续选择。
export default <T> (getList: () => T[], listRef: Ref<any>) => {
  const selectedList = shallowRef<T[]>([])
  const isSelectionMode = ref(false)
  let anchor = -1
  const removeAllSelect = () => {
    selectedList.value = []
    isSelectionMode.value = false
    anchor = -1
  }
  const startSelection = (index?: number) => {
    if (!getList().length) return
    isSelectionMode.value = true
    if (index == null) return
    const item = getList()[index]
    if (item == null) return
    anchor = index
    if (!selectedList.value.includes(item)) selectedList.value = [...selectedList.value, item]
  }
  const handleSelectAllData = () => {
    isSelectionMode.value = !!getList().length
    selectedList.value = [...getList()]
    anchor = getList().length ? 0 : -1
  }
  const invertSelection = () => {
    const selected = new Set(selectedList.value)
    selectedList.value = getList().filter(item => !selected.has(item))
    isSelectionMode.value = !!getList().length
    anchor = -1
  }
  const toggleSelectData = (index: number) => {
    const item = getList()[index]
    if (item == null) return
    isSelectionMode.value = true
    anchor = index
    selectedList.value = selectedList.value.includes(item)
      ? selectedList.value.filter(selected => selected !== item)
      : [...selectedList.value, item]
  }
  const handleSelectData = (index: number, event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
    const list = getList()
    if (list[index] == null) return true
    if (event.shiftKey) {
      if (anchor < 0 || anchor >= list.length) anchor = index
      selectedList.value = list.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
      isSelectionMode.value = true
    } else if (event.ctrlKey || event.metaKey || isSelectionMode.value) toggleSelectData(index)
    else {
      anchor = index
      return false
    }
    return true
  }
  const selectFromMenu = (index: number) => {
    if (isSelectionMode.value) toggleSelectData(index)
    else startSelection(index)
  }
  const handleSelectAllKey = ({ event }: LX.KeyDownEevent) => {
    const target = event?.target as HTMLElement | undefined
    const root = listRef.value?.$el as HTMLElement | undefined
    if (!event || !target || !root?.contains(document.activeElement) || target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) || (target.tagName == 'INPUT' && (target as HTMLInputElement).type != 'checkbox')) return
    event.preventDefault()
    if (!event.repeat) handleSelectAllData()
  }
  window.key_event.on('key_mod+a_down', handleSelectAllKey)
  onBeforeUnmount(() => { window.key_event.off('key_mod+a_down', handleSelectAllKey) })
  return { selectedList, isSelectionMode, startSelection, removeAllSelect, handleSelectAllData, invertSelection, toggleSelectData, handleSelectData, selectFromMenu }
}
