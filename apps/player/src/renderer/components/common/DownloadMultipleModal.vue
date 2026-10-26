<template>
  <material-modal :show="show" :heading="$t('download__multiple_tip', { len: onlineList.length })" :bg-close="bgClose" :teleport="teleport" @close="handleClose">
    <main class="scroll" :class="$style.main">
      <p>{{ $t('download__multiple_tip2') }}</p>
      <p v-if="list.length != onlineList.length">{{ $t('download_local_skipped', { count: list.length - onlineList.length }) }}</p>
      <p v-if="error" role="alert">{{ error === true ? $t('player_download_failed') : error }}</p>
      <DownloadQualityOptions v-if="onlineList.length" :qualities="qualities" :working="working" @select="handleClick" />
    </main>
  </material-modal>
</template>

<script>
import { createDownloadTasks } from '@renderer/store/download/action'
import DownloadQualityOptions from './DownloadQualityOptions.vue'

export default {
  components: { DownloadQualityOptions },
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    listId: {
      type: String,
      default: '',
    },
    list: {
      type: Array,
      default() {
        return []
      },
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show', 'confirm'],
  data: () => ({ working: false, error: false, qualities: ['128k', '320k', 'flac', 'flac24bit'].map(type => ({ type })) }),
  computed: { onlineList() { return this.list.filter(item => item.source != 'local') } },
  watch: { show() { this.error = false } },
  methods: {
    async handleClick(quality) {
      if (this.working || !this.onlineList.length) return
      this.working = true
      this.error = false
      try {
        await createDownloadTasks(this.onlineList, quality, this.listId)
        this.$emit('update:show', false)
        this.$emit('confirm')
      } catch (error) { this.error = error?.code === 'DOWNLOAD_TASK_ACTIVE' ? error.message : true } finally { this.working = false }
    },
    handleClose() {
      if (this.working) return
      this.$emit('update:show', false)
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 0 22px 12px;
  width: min(304px, calc(100vw - 110px));
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-flow: column nowrap;
  color: var(--color-font);
  gap: 12px;
  > * { flex-shrink: 0; }
  p { font-size: 12px; line-height: 1.6; color: var(--color-font-label); }
}

</style>
