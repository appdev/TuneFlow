<template>
  <div :class="$style.options" :aria-busy="working">
    <button v-for="quality in qualities" :key="quality.type" type="button" :class="$style.option" :disabled="working" @click="$emit('select', quality.type)">
      <span :class="$style.info">
        <span :class="$style.name">{{ $t(quality.type == '320k' ? 'download__high_quality' : ['128k', '192k'].includes(quality.type) ? 'download__normal' : 'download__lossless') }}</span>
        <span :class="$style.description">{{ quality.type == 'flac24bit' ? 'FLAC · Hi-Res' : /^\d+k$/.test(quality.type) ? `${quality.type.slice(0, -1)} kbps` : quality.type.toUpperCase() }}</span>
      </span>
      <span v-if="quality.size" :class="$style.size">{{ quality.size.toUpperCase() }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>
    </button>
    <p v-if="working" role="status" :class="$style.status">{{ $t('download_tasks_adding') }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ qualities: Array<{ type: string, size?: string | null }>, working: boolean }>()
defineEmits<{ select: [quality: string] }>()
</script>

<style lang="less" module>
.options { display: flex; flex-direction: column; }
.option {
  position: relative;
  width: calc(100% + 16px);
  min-height: 62px;
  margin: 0 -8px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 8px;
  border: none;
  border-radius: 8px;
  text-align: left;
  background: transparent;
  color: var(--color-font);
  cursor: pointer;
  transition: background-color .16s ease;
  & + &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 8px;
    right: 8px;
    height: 1px;
    background: rgb(from var(--color-font) r g b / .08);
    pointer-events: none;
  }
  &:hover:not(:disabled) { background: rgb(from var(--color-font) r g b / .045); }
  &:active:not(:disabled) { background: rgb(from var(--color-font) r g b / .075); }
  &:focus-visible { outline: 2px solid var(--color-font-label); outline-offset: -2px; }
  &:disabled { opacity: .5; cursor: wait; }
  > svg {
    width: 16px; height: 16px; flex: none; fill: none;
    stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
    color: var(--color-font-label);
    transition: color .16s ease;
  }
  &:hover:not(:disabled) > svg { color: var(--color-font); }
}
.info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.name { font-size: 13px; font-weight: 500; line-height: 1.5; }
.description, .size, .status { color: var(--color-font-label); font-size: 11px; line-height: 1.5; }
.size { flex: none; font-variant-numeric: tabular-nums; }
.status { margin: 8px 0 0; }

@media (prefers-reduced-motion: reduce) {
  .option, .option > svg { transition: none; }
}
</style>
