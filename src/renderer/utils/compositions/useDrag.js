import Sortable, { AutoScroll } from 'sortablejs/modular/sortable.core.esm'
import { onBeforeUnmount, onMounted } from '@common/utils/vueTools'
import { clearDownKeys } from '@renderer/event'

Sortable.mount(new AutoScroll())

const noop = () => {}

export default ({ dom_list, dragingItemClassName, filter, forceFallback = false, onUpdate, onStart = noop, onEnd = noop }) => {
  let sortable
  let sortableElement

  const ensureSortable = () => {
    const element = dom_list.value
    if (!element || (sortable && sortableElement === element)) return
    sortable?.destroy()
    sortableElement = element
    sortable = Sortable.create(element, {
      animation: 150,
      disabled: true,
      forceFallback,
      filter: filter ? '.' + filter : null,
      ghostClass: dragingItemClassName,
      onUpdate(event) {
        onUpdate(event.newIndex, event.oldIndex)
      },
      onMove(event) {
        return filter ? !event.related.classList.contains(filter) : true
      },
      onChoose() {
        onStart()
      },
      onUnchoose() {
        onEnd()
        // 处于拖动状态期间，键盘事件无法监听，拖动结束手动清理按下的键
        // window.app_event.emit(eventBaseName.setClearDownKeys)
        clearDownKeys()
      },
      onStart(event) {
        window.app_event.dragStart()
      },
      onEnd(event) {
        window.app_event.dragEnd()
      },
    })
  }

  onMounted(ensureSortable)
  onBeforeUnmount(() => {
    sortable?.destroy()
    sortable = null
    sortableElement = null
  })

  return {
    setDisabled(enable) {
      ensureSortable()
      if (!sortable) return
      sortable.option('disabled', enable)
    },
  }
}
