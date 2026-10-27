<template>
  <section :class="$style.setup">
    <h2>{{ status.hasConnected ? '连接暂时不可用' : '先连接音乐服务' }}</h2>
    <p>{{ status.hasConnected ? '页面和已输入的内容会保留，连接恢复后即可继续。' : '连接后即可使用搜索、音乐库、歌单和下载；音乐平台账号可稍后登录。' }}</p>
    <ServerSettings v-if="!isServerBoundWeb && !status.hasConnected" section="connection" />
    <template v-else>
      <p v-if="isServerBoundWeb">正在连接当前站点：{{ status.endpoint }}</p>
      <p v-if="status.error" role="status">{{ status.error }}</p>
      <button :disabled="status.busy" @click="checkService(true)">{{ status.busy ? '正在连接…' : '重新连接' }}</button>
      <router-link v-if="!isServerBoundWeb" to="/setting?name=SettingService">连接设置</router-link>
    </template>
    <router-link to="/setting?name=SettingBasic">调整外观与本机设置</router-link>
  </section>
</template>
<script setup lang="ts">
import ServerSettings from './ServerSettings.vue'
import { checkService, isServerBoundWeb } from './session'
import { useServiceStatus } from './useSession'
const status = useServiceStatus()
</script>
<style module lang="less">
.setup { max-width: 720px; margin: 24px auto; padding: 24px; color: var(--color-font); line-height: 1.8; h2 { font-size: 22px; } p { margin: 12px 0; } button, a { display: inline-block; color: inherit; margin: 8px 12px 8px 0; } button { padding: 8px 14px; border: 1px solid var(--q-outline); border-radius: 8px; background: var(--q-surface); cursor: pointer; } }
</style>
