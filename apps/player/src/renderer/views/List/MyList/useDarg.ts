import { ref, nextTick, type Ref, useCssModule } from '@common/utils/vueTools'
import { updateUserListPosition, getUserLists } from '@renderer/store/list/action'
import { userListsUpdatePosition } from '@renderer/store/list/listManage/action'
import useDrag from '@renderer/utils/compositions/useDrag'
import { dialog } from '@renderer/plugins/Dialog'

export default ({ dom_lists_list, handleMenuClick }: {
  dom_lists_list: Ref<HTMLElement | null>
  handleMenuClick: () => void
}) => {
  const isDragging = ref(false)
  let suppressClickUntil = 0
  const styles = useCssModule()
  const drag = useDrag({
    dom_list: dom_lists_list,
    disabled: false,
    draggable: '.user-list:not(.default-list)',
    filter: 'default-list',
    filterSelector: '.default-list, input, .' + styles.editing,
    dragingItemClassName: styles.dragingItem,
    floatingClassName: styles.dragFloating,
    chosenClassName: styles.dragChosen,
    onDragStart() {
      isDragging.value = true
      handleMenuClick()
    },
    onDragEnd(event?: { item: HTMLElement }) {
      isDragging.value = false
      suppressClickUntil = performance.now() + 250
      if (!event || event.item.dataset.dragMotion != 'true') return
      void nextTick(() => {
        if (!event.item.isConnected) return
        event.item.animate([
          { scale: '1.035', offset: 0 },
          { scale: '.985', offset: 0.48 },
          { scale: '1.008', offset: 0.76 },
          { scale: '1', offset: 1 },
        ], { duration: 360, easing: 'ease-out' })
      })
    },
    onUpdate(newIndex: number, oldIndex: number, event: { item: HTMLElement, from: HTMLElement }) {
      const id = event.item.dataset.listId
      // 同一帧内还原 DOM 并更新响应式顺序，避免等待 IPC 时先跳回旧位置。
      event.item.remove()
      event.from.insertBefore(event.item, event.from.children[oldIndex] ?? null)
      if (!id || newIndex < 4 || oldIndex < 4 || newIndex == oldIndex) return
      userListsUpdatePosition(newIndex - 2, [id])
      drag.setDisabled(true)
      void updateUserListPosition({ ids: [id], position: newIndex - 2 }).catch(async() => {
        await getUserLists().catch(() => {})
        await dialog({ message: window.i18n.t('lists__sort_failed') })
      }).finally(() => { drag.setDisabled(false) })
    },
  })
  return { isDragging, suppressDragClick: () => isDragging.value || performance.now() < suppressClickUntil }
}
