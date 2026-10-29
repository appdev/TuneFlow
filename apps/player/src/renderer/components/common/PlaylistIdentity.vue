<template>
  <span :class="$style.identity">
    <span :class="$style.local" aria-hidden="true"><svg-icon :name="list.id == 'love' ? 'love' : 'music'" /></span>
    <span :class="$style.copy">
      <span :class="$style.name">{{ name || list.name }}</span>
      <span v-if="subtitle" :class="$style.source">{{ sourceName }}</span>
    </span>
  </span>
</template>

<script>
import { computed } from '@common/utils/vueTools'

export default {
  props: {
    list: { type: Object, required: true },
    name: { type: String, default: '' },
    subtitle: { type: Boolean, default: false },
  },
  setup(props) {
    const source = computed(() => props.list.source)
    const sourceName = computed(() => props.list.id === 'service_library' ? '服务器音乐库' : props.list.id === 'service_history' ? '服务器播放记录' : source.value ? `${({ tx: 'QQ音乐', wy: '网易云音乐', kg: '酷狗音乐', kw: '酷我音乐', mg: '咪咕音乐' })[source.value] || source.value} · 服务器` : '服务器歌单')
    return { source, sourceName }
  },
}
</script>

<style lang="less" module>
.identity { display: inline-flex; width: 100%; min-width: 0; align-items: center; gap: 10px; text-align: left; }
.local { width: 22px; height: 22px; flex: none; display: grid; place-items: center; color: var(--color-font-label); }
.local svg { width: 18px; height: 18px; }
.copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; line-height: 1.25; }
.name { font-size: var(--q-list-title-size); font-weight: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source { font-size: var(--q-list-detail-size); font-weight: 400; color: var(--q-list-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
