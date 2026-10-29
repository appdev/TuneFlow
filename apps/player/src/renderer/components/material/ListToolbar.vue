<template>
  <div :class="$style.toolbar">
    <slot name="heading" />
    <span :class="[$style.count, { [$style.selected]: selecting }]" role="status">
      {{ $t(selecting ? 'list__selected_count' : pageOnly ? 'list__page_count' : 'list__count', { count: selecting ? selectedCount : count }) }}
    </span>
    <div :class="$style.actions">
      <button v-if="showPlay && !selecting" type="button" :class="$style.primary" :disabled="!count" @click="$emit('play')">
        <svg-icon name="play-outline" />{{ $t('list__play_all') }}
      </button>
      <button v-if="count && !selecting" type="button" @click="$emit('select')">{{ $t('list__multi_select') }}</button>
      <button v-if="count" type="button" :disabled="selectedCount == count" @click="$emit('select-all')">{{ $t(pageOnly ? 'list__select_page' : 'list__select_all') }}</button>
      <template v-if="selecting">
        <button type="button" :disabled="!count" @click="$emit('invert')">{{ $t(pageOnly ? 'list__invert_page' : 'list__invert_selection') }}</button>
        <slot name="selected-actions">
          <button type="button" :disabled="!selectedCount" @click="$emit('add')">{{ $t('list__add_to') }}</button>
          <button v-if="downloadVisible" type="button" :disabled="!selectedCount || !downloadEnabled" @click="$emit('download')">{{ $t('list__download') }}</button>
        </slot>
        <button type="button" @click="$emit('clear')">{{ $t('list__clear_selection') }}</button>
      </template>
    </div>
  </div>
</template>

<script setup>
defineProps({
  count: { type: Number, required: true },
  selectedCount: { type: Number, default: 0 },
  selecting: Boolean,
  pageOnly: Boolean,
  showPlay: Boolean,
  downloadVisible: Boolean,
  downloadEnabled: Boolean,
})
defineEmits(['play', 'add', 'download', 'clear', 'select', 'select-all', 'invert'])
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.toolbar {
  flex: none;
  min-height: 44px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 6px 12px;
  box-sizing: border-box;
  border-bottom: 1px solid rgb(from var(--color-font) r g b / .07);
}
.count {
  flex: none;
  color: var(--color-font-label);
  font-size: var(--q-list-detail-size);
  font-variant-numeric: tabular-nums;
  &.selected { color: var(--color-primary); font-weight: 600; }
}
.actions {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  button {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: none;
    border-radius: 9px;
    color: var(--color-font);
    background: transparent;
    font: inherit;
    font-size: var(--q-list-detail-size);
    cursor: pointer;
    transition: background-color @transition-fast, color @transition-fast;
    &:hover:not(:disabled) { color: var(--color-primary); background: var(--color-primary-background-hover); }
    &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    &:disabled { opacity: .4; cursor: default; }
    &.primary { color: var(--color-primary); background: var(--color-primary-alpha-900); }
    svg { width: 14px; height: 14px; }
  }
}
</style>
