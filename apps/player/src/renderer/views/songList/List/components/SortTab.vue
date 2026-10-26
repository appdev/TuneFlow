<template>
  <div :class="$style.tabs" role="tablist">
    <button
      v-for="item in list" :key="item.id" type="button" role="tab"
      :class="[$style.tab, { [$style.active]: sortId == item.id }]"
      :aria-selected="sortId == item.id" @click="handleToggle(item.id)"
    >{{ item.name }}</button>
  </div>
</template>

<script setup>
import { computed } from '@common/utils/vueTools'
import { sortList } from '@renderer/store/songList/state'
import { useRouter } from '@common/utils/vueRouter'

const props = defineProps({
  source: { type: String, required: true },
  tagId: { type: String, required: true },
  sortId: { type: String, default: '' },
})
const router = useRouter()
const list = computed(() => sortList[props.source] ?? [])
const handleToggle = (id) => {
  if (id == props.sortId) return
  void router.replace({
    path: '/songList/list',
    query: { source: props.source, tagId: props.tagId, sortId: id, page: '1' },
  })
}
</script>

<style lang="less" module>
.tabs { display: flex; gap: 3px; padding: 3px; border-radius: 11px; background: var(--color-primary-alpha-900); }
.tab {
  border: 0; padding: 8px 16px; border-radius: 8px; font: inherit; font-size: 12px;
  color: var(--color-font-label); background: transparent; cursor: pointer;
  transition: background-color .18s, color .18s;
  &:hover { color: var(--color-font); }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
  &.active { color: var(--color-font); font-weight: 600; background: var(--color-main-background); box-shadow: 0 2px 5px rgb(0 0 0 / .08); }
}
</style>
