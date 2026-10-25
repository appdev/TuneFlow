<template>
  <div v-if="!status.connected" :class="$style.status" role="status">
    <span>{{ status.busy ? '正在连接…' : status.error || '尚未连接' }}</span>
    <button :disabled="status.busy" @click="checkService(true)">重试</button>
    <router-link to="/setting?name=SettingService">连接设置</router-link>
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { serviceStatus, subscribeService, checkService } from './session'
const status = ref({ ...serviceStatus })
onBeforeUnmount(subscribeService(() => { status.value = { ...serviceStatus } }))
</script>
<style module lang="less">
.status { position: absolute; z-index: 10; right: 14px; bottom: 8px; padding: 8px 12px; border-radius: 8px; background: var(--color-primary); color: var(--color-font); display: flex; gap: 12px; align-items: center; button, a { color: inherit; background: transparent; cursor: pointer; text-decoration: underline; } }
</style>
