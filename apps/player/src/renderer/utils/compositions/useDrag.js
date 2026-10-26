import Sortable, { AutoScroll } from 'sortablejs/modular/sortable.core.esm'
import { onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { clearDownKeys } from '@renderer/event'
import { isShowAnimation } from '@renderer/store/setting'

Sortable.mount(new AutoScroll())

const noop = () => {}

export default ({ dom_list, dragingItemClassName, floatingClassName, chosenClassName, filter, draggable, filterSelector, disabled = true, onUpdate, onStart = noop, onEnd = noop, onDragStart = noop, onDragEnd = noop }) => {
  let sortable

  onMounted(() => {
    sortable = Sortable.create(dom_list.value, {
      animation: 260,
      easing: 'cubic-bezier(.22, 1.28, .36, 1)',
      disabled,
      draggable,
      // 应用禁止浏览器原生拖图，使用指针拖动避免 Chromium 的 user-drag 样式拦截。
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 5,
      filter: filterSelector || (filter ? '.' + filter : null),
      preventOnFilter: false,
      ghostClass: dragingItemClassName,
      fallbackClass: floatingClassName,
      chosenClass: chosenClassName,
      onUpdate(event) {
        onUpdate(event.newIndex, event.oldIndex, event)
      },
      onMove(event) {
        return filter ? !event.related.classList.contains(filter) : true
      },
      onChoose(event) {
        const motion = isShowAnimation.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        sortable.option('animation', motion ? 260 : 0)
        event.item.dataset.dragMotion = String(motion)
        onStart()
      },
      onUnchoose() {
        onEnd()
        // 处于拖动状态期间，键盘事件无法监听，拖动结束手动清理按下的键
        // window.app_event.emit(eventBaseName.setClearDownKeys)
        clearDownKeys()
      },
      onStart(event) {
        onDragStart(event)
        window.app_event.dragStart()
      },
      onEnd(event) {
        onDragEnd(event)
        delete event.item.dataset.dragMotion
        window.app_event.dragEnd()
      },
    })
  })
  onBeforeUnmount(() => { sortable?.destroy() })

  return {
    setDisabled(enable) {
      if (!sortable) return
      sortable.option('disabled', enable)
    },
  }
}
