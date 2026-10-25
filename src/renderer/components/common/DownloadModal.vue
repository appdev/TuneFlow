<template>
  <material-modal :show="show" :heading="service ? '下载到服务器' : $t('download_track_title')" :bg-close="bgClose" :teleport="teleport" @close="handleClose">
    <main class="scroll" :class="$style.main">
      <div :class="$style.track">
        <div :class="$style.cover" aria-hidden="true">
          <img v-if="info.meta?.picUrl && !coverFailed" :src="info.meta.picUrl" alt="" @error="coverFailed = true">
          <EmptyCoverMark v-else />
        </div>
        <div :class="$style.trackInfo">
          <p :class="$style.song">{{ info.name }}</p>
          <p :class="$style.singer">{{ info.singer }}</p>
        </div>
      </div>
      <p v-if="!qualitys.length" :class="$style.message">{{ $t('player_download_unavailable') }}</p>
      <p v-if="error" role="status" :class="$style.message">{{ $t('player_download_failed') }}</p>
      <DownloadQualityOptions :qualities="qualitys" :working="working" @select="handleClick" />
    </main>
  </material-modal>
</template>

<script>
import { qualityList } from '@renderer/store'
import { createDownloadTasks } from '@renderer/store/download/action'
import DownloadQualityOptions from './DownloadQualityOptions.vue'
import EmptyCoverMark from './EmptyCoverMark.vue'
import { getServiceProvenance } from '@renderer/service/tracks'

export default {
  components: { DownloadQualityOptions, EmptyCoverMark },
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: [Object, null],
      required: true,
    },
    listId: {
      type: String,
      default: '',
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show'],
  setup() {
    return {
      qualityList,
    }
  },
  data: () => ({ working: false, error: false, coverFailed: false }),
  computed: {
    service() { return getServiceProvenance(this.musicInfo) },
    info() {
      return this.musicInfo || {}
    },
    sourceQualityList() {
      if (this.service) return ['128k', '320k', 'flac', 'flac24bit']
      return this.qualityList[this.info.source] || []
    },
    qualitys() {
      if (this.service) return this.sourceQualityList.map(type => ({ type, size: null }))
      return this.info.meta?.qualitys?.filter(quality => this.checkSource(quality.type)) || []
    },
  },
  watch: { show() { this.error = false; this.coverFailed = false } },
  methods: {
    async handleClick(quality) {
      if (this.working) return
      this.working = true
      this.error = false
      try {
        await createDownloadTasks([this.musicInfo], quality, this.listId)
        this.$emit('update:show', false)
      } catch { this.error = true } finally { this.working = false }
    },
    handleClose() {
      if (this.working) return
      this.$emit('update:show', false)
    },
    checkSource(quality) {
      return this.sourceQualityList.includes(quality)
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
  > * { flex-shrink: 0; }
}
.track { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
.cover {
  width: 42px; height: 42px; flex: none; overflow: hidden; border-radius: 7px;
  color: var(--color-font-label);
  background: rgb(from var(--color-font) r g b / .05);
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  > svg { width: 100%; height: 100%; padding: 10px; box-sizing: border-box; }
}
.trackInfo { flex: 1; min-width: 0; }
.song { font-size: 14px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
.singer { font-size: 12px; line-height: 1.5; color: var(--color-font-label); margin: 3px 0 0; overflow-wrap: anywhere; }
.message { font-size: 13px; line-height: 1.6; margin-bottom: 14px; color: var(--color-font-label); }

</style>
