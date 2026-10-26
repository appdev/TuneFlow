<template>
  <div :class="$style.container">
    <div :class="$style.actions">
      <base-btn :disabled="queueLoading || !listDetailInfo.list.length || !!listDetailInfo.noItemLabel" @click="handlePlayList(0, true)">{{ $t(queueLoading ? 'list__loading' : 'list__play_all') }}</base-btn>
      <base-btn :disabled="loading || !boardId" @click="getList(boardId, listDetailInfo.page, true)">{{ $t(failed ? 'play_queue__retry' : 'playlist_import_modal__refresh') }}</base-btn>
      <span v-if="queueError" role="status">{{ $t('leaderboard__queue_failed') }}</span>
    </div>
    <div :class="$style.songs" :aria-busy="loading">
    <material-online-list
      ref="listRef"
      :page="listDetailInfo.page"
      :limit="listDetailInfo.limit"
      :total="listDetailInfo.total"
      :list="listDetailInfo.list"
      :no-item="listDetailInfo.noItemLabel"
      source-tag
      play-in-context
      @show-menu="hideListsMenu"
      @play-list="handlePlayList"
      @toggle-page="togglePage"
    />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from '@common/utils/vueTools'
import { clearListDetail } from '@renderer/store/leaderboard/action'
import useList from './useList'


const props = defineProps<{
  source: LX.OnlineSource
  boardId?: string
}>()

const emit = defineEmits(['show-menu'])

const {
  listRef,
  listDetailInfo,
  getList,
  handlePlayList,
  queueLoading,
  queueError,
} = useList()

const loading = computed(() => listDetailInfo.noItemLabel == window.i18n.t('list__loading'))
const failed = computed(() => listDetailInfo.noItemLabel == window.i18n.t('list__load_failed'))
watch(() => [props.source, props.boardId], ([source, boardId]) => {
  if (!boardId || !boardId.startsWith(`${source}__`)) { clearListDetail(); return }
  getList(boardId, 1)
}, {
  immediate: true,
})


const hideListsMenu = () => {
  emit('show-menu')
}

const togglePage = (page: number) => {
  if (!listDetailInfo.id) return
  getList(listDetailInfo.id, page)
}

const hideMenu = () => {
  listRef.value?.handleMenuClick?.()
}

defineExpose({ hideMenu })


</script>


<style lang="less" module>
.container {
  display: flex;
  flex-flow: column nowrap;
  flex: 1;
  min-height: 0;
}
.actions { display: flex; gap: 8px; padding: 12px 18px 4px; }
.songs { position: relative; flex: 1; min-height: 0; }

.list {
  overflow: hidden;
  height: 100%;
  flex: auto;
}

</style>
