<template>
  <div v-if="loading || failed" :class="$style.notice" role="status">
    <span>{{ $t(loading ? 'list__loading' : 'list__load_failed') }}</span>
    <base-btn v-if="failed" @click="loadBoards">{{ $t('play_queue__retry') }}</base-btn>
  </div>
  <ul v-else ref="dom_lists_list" class="scroll" :class="$style.listsContent">
    <li
      v-for="(item, index) in list"
      :key="item.id" :class="[$style.listsItem, { [$style.active]: item.id == boardId }, { [$style.clicked]: rightClickItemIndex == index }]"
      role="button" tabindex="0" :aria-pressed="item.id == boardId" :aria-label="item.name" @click="handleToggleList(item.id)" @keydown.enter="handleToggleList(item.id)" @keydown.space.prevent="handleToggleList(item.id)" @contextmenu="handleRigthClick($event, index)"
    >
      <span :class="$style.listsLabel">
        <span :class="$style.number">{{ String(index + 1).padStart(2, '0') }}</span>
        <span :class="$style.name">{{ item.name }}</span>
      </span>
    </li>
  </ul>
  <base-menu
    v-model="isShowMenu"
    :menus="menus"
    :xy="menuLocation"
    item-name="name"
    @menu-click="handleMenuClick"
  />
</template>

<script setup>
import { watch, shallowReactive, ref, onBeforeUnmount } from '@common/utils/vueTools'
import { getBoardsList, setBoard } from '@renderer/store/leaderboard/action'
import { boards } from '@renderer/store/leaderboard/state'
import useMenu from './useMenu'
import { useRouter, useRoute } from '@common/utils/vueRouter'

const props = defineProps({
  source: {
    type: String,
    required: true,
  },
  boardId: {
    type: [String, undefined],
    default: undefined,
  },
})

const emit = defineEmits(['show-menu'])

const router = useRouter()
const route = useRoute()

const list = shallowReactive([])
const rightClickItemIndex = ref(-1)
let requestId = 0
const loading = ref(false)
const failed = ref(false)
let mounted = true
onBeforeUnmount(() => { mounted = false; requestId++ })

const handleToggleList = (id) => {
  if (!mounted || route.name != 'Leaderboard') return
  void router.replace({
    path: route.path,
    query: {
      source: props.source,
      boardId: id,
    },
  })
}

const {
  menus,
  menuLocation,
  isShowMenu,
  showMenu,
  menuClick,
} = useMenu({ emit, list })

const handleRigthClick = (event, index) => {
  rightClickItemIndex.value = index
  showMenu(event, index)
}
const handleMenuClick = (action) => {
  if (rightClickItemIndex.value < 0) return
  let index = rightClickItemIndex.value
  rightClickItemIndex.value = -1
  menuClick(action, index, props.source)
}


const loadBoards = async() => {
  const source = props.source
  if (!source) return
  const currentRequestId = ++requestId
  loading.value = true
  failed.value = false
  // const source = (await getLeaderboardSetting()).source as LX.OnlineSource
  let boardList = boards[source]
  try {
    if (boardList == null) setBoard(boardList = await getBoardsList(source), source)
  } catch (error) {
    if (currentRequestId == requestId) { list.splice(0, list.length); failed.value = true; loading.value = false }
    console.warn(`Failed to load leaderboard boards: ${source}`, error)
    return
  }
  if (currentRequestId != requestId || source != props.source) return
  list.splice(0, list.length, ...boardList.list)
  loading.value = false
  if (boardList.list.length && !boardList.list.some(item => item.id == props.boardId)) handleToggleList(boardList.list[0].id)
}
watch(() => props.source, loadBoards, {
  immediate: true,
})

defineExpose({ hideMenu: handleMenuClick })

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.listsContent {
  flex: auto;
  min-width: 0;
  overflow-y: scroll;
  padding: 7px;
  box-sizing: border-box;
  // overflow-y: scroll !important;
  // border-right: 1px solid rgba(0, 0, 0, 0.12);
}
.notice { padding: 20px 12px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; }
.listsItem {
  color: var(--q-list-text);
  font-weight: 400;
  position: relative;
  margin-bottom: 3px;
  border-radius: 12px;
  transition: .3s ease;
  transition-property: color, background-color;
  background-color: transparent;
  &:hover:not(.active) {
    background-color: var(--color-primary-background-hover);
    cursor: pointer;
  }
  &.active {
    color: var(--q-list-accent);
    font-weight: 600;
    background-color: rgb(from var(--color-main-background) r g b / .76);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .78), 0 8px 20px rgba(72, 91, 112, .08);
  }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
  &.selected {
    background-color: var(--color-primary-font-active);
  }
  &.clicked {
    background-color: var(--color-primary-background-hover);
  }
  &.editing {
    padding: 0 10px;
    background-color: var(--color-primary-background-hover);
    .listsLabel {
      display: none;
    }
    .listsInput {
      display: block;
    }
  }
}
.activeIcon {
  height: .9em;
  width: .9em;
  margin-right: .35em;
  vertical-align: -0.05em;
}
.listsLabel {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 0 12px;
  font-size: var(--q-list-title-size);
  line-height: 40px;
  .mixin-ellipsis-1();
}
.number { flex: none; width: 24px; font-size: var(--q-list-detail-size); color: var(--q-list-muted); font-weight: 400; font-variant-numeric: tabular-nums; }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }


</style>

