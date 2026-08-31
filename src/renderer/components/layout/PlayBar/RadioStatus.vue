<template>
  <button v-if="radioSessionId" :class="$style.status" :title="$t('radio__stop')" @click="stopRadio">
    <span :class="$style.dot" />
    <span :class="$style.label">{{ $t(`radio__status_${radioAIStatus}`) }}</span>
  </button>
</template>

<script setup lang="ts">
import { stopRadio } from '@renderer/views/Radio/player'
import { radioAIStatus, radioSessionId } from '@renderer/views/Radio/state'
</script>

<style lang="less" module>
.status { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; border: 0; border-radius: 999px; color: var(--color-button-font); background: transparent; cursor: pointer; opacity: .75; }
.status:hover { opacity: 1; background: var(--color-primary-light-300-alpha-300); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light-300-alpha-300); }
.label { max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
@media (max-width: 700px) { .label { display: none; } }
</style>
