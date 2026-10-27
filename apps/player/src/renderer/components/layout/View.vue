<template>
  <div :class="$style.view">
    <!-- 弹窗 teleport 到 #view，必须与路由节点分层，避免离场时删除新页面使用的插入锚点。 -->
    <ConnectionSetup v-if="!status.hasConnected && currentRoute.name !== 'Setting'" />
    <div v-else :class="$style.pages">
      <router-view v-slot="{ Component, route }">
        <!-- 导航内容直接显示，避免整页渐显延迟反馈和新旧页面同时绘制。 -->
        <!-- 筛选和翻页复用页面，避免新旧实例同时请求、取消请求和修改路由。 -->
        <keep-alive include="Search,ServerDownloads" :max="2">
          <component :is="Component" :key="['Search', 'Leaderboard', 'SongList', 'SongListDetail', 'List', 'Download', 'Setting'].includes(route.name) ? route.path : route.fullPath" class="view-container" />
        </keep-alive>
      </router-view>
    </div>
    <ConnectionStatus />
  </div>
</template>

<script setup>
import ConnectionStatus from '@renderer/service/ConnectionStatus.vue'
import ConnectionSetup from '@renderer/service/ConnectionSetup.vue'
import { useServiceStatus } from '@renderer/service/useSession'
import { useRoute } from '@common/utils/vueRouter'
const status = useServiceStatus()
const currentRoute = useRoute()
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.view {
  position: relative;
  z-index: 1;
}
.pages {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  > :global(.view-container) {
    position: absolute !important;
    left: 0;
    top: 0;
    height: 100%;
    width: 100%;
  }
}

</style>
