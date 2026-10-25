<template>
  <section :class="$style.panel">
    <template v-if="section === 'connection'">
      <h2>服务器连接 · Web</h2><p>已绑定当前页面的服务器：{{ origin }}</p>
      <p>歌单、收藏、音乐库、历史、音源和下载与桌面端及 Android 共享。</p>
      <button @click="refresh">重新连接 / 刷新</button><p role="status">{{ message }}</p>
    </template>
    <template v-else-if="section === 'appearance'">
      <h2>外观 · 当前浏览器</h2>
      <label>界面字号 <input aria-label="界面字号" type="number" min="12" max="24" :value="appSetting['common.fontSize']" @change="save({ 'common.fontSize': Math.max(12, Math.min(24, Number($event.target.value))) })"></label>
      <label>主题 <select aria-label="主题" :value="appSetting['theme.id']" @change="save({ 'theme.id': $event.target.value })"><option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option></select></label>
      <label>外观模式 <select aria-label="外观模式" :value="appSetting['theme.appearance']" @change="save({ 'theme.appearance': $event.target.value })"><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
      <label>界面语言 <select aria-label="界面语言" :value="appSetting['common.langId']" @change="save({ 'common.langId': $event.target.value })"><option value="zh-cn">简体中文</option><option value="en-us">English</option><option value="zh-tw">繁體中文</option></select></label>
      <p>设置仅保存在当前浏览器，不覆盖桌面端、Android 或服务器配置。</p>
    </template>
    <template v-else-if="section === 'playback'">
      <h2>播放 · 当前浏览器</h2>
      <label>播放音质 <select aria-label="播放音质" :value="appSetting['player.playQuality']" @change="save({ 'player.playQuality': $event.target.value })"><option value="128k">标准</option><option value="320k">高品质</option><option value="flac">无损</option></select></label>
      <label>音量 <input aria-label="音量" type="range" min="0" max="1" step="0.05" :value="appSetting['player.volume']" @change="save({ 'player.volume': Number($event.target.value) })"></label>
      <p>解析、跨平台切换和下载由 Docker 执行；声音由浏览器播放。首次播放需要点击。浏览器格式支持和自动播放策略仍然生效。</p>
    </template>
    <template v-else>
      <h2>Web 能力说明</h2>
      <p>本页支持服务器歌单、推荐、音乐库、音源、设置与下载。下载文件保存在 Docker 音乐目录，不是当前设备的下载目录。</p>
      <p>平台官方登录、账号个人推荐、桌面歌词、全局快捷键和本机文件操作请使用桌面端或 Android。平台账号凭证不会上传到 Docker；已经导入服务器的账号歌单在这里直接可见。</p>
      <p>Web 首页使用 Docker 推荐。服务器数据持续共享，浏览器外观、音量、队列和播放恢复信息独立保存。</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import themes from '@common/theme/index.json'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import { checkService } from './session'
defineProps<{ section: string }>()
const origin = location.origin
const message = ref('')
const save = (patch: Partial<LX.AppSetting>) => { void updateSetting(patch) }
const refresh = async() => { await checkService(true); message.value = '已完成连接检查' }
</script>
<style module lang="less">
.panel { padding: 20px; line-height: 1.8; color: var(--color-font); h2 { font-size: 20px; } p { margin: 12px 0; } label { display: flex; gap: 16px; align-items: center; margin: 16px 0; } input, select, button { color: inherit; background: transparent; border: 1px solid currentColor; padding: 6px; border-radius: 5px; } select { max-width: 240px; } }
</style>
