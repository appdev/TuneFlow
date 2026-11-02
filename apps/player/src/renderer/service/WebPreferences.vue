<template>
  <section class="tf-web-preferences" :class="$style.panel">
    <template v-if="section === 'appearance'">
      <h2>基本设置</h2><p>让 TuneFlow 更适合你的日常。</p>
      <h3>外观</h3>
      <div :class="$style.themeOptions" role="group" aria-label="外观模式">
        <button v-for="mode in appearanceModes" :key="mode.id" type="button" :aria-pressed="appSetting['theme.appearance'] === mode.id" @click="save({ 'theme.appearance': mode.id })"><span :class="[$style.swatch, $style[mode.id]]" aria-hidden="true"><i /><i /><i /></span>{{ mode.name }}</button>
      </div>
      <label>界面字号 <input aria-label="界面字号" type="number" min="12" max="24" :value="appSetting['common.fontSize']" @change="save({ 'common.fontSize': Math.max(12, Math.min(24, Number($event.target.value))) })"></label>
      <label>主题 <select aria-label="主题" :value="appSetting['theme.id']" @change="save({ 'theme.id': $event.target.value })"><option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option></select></label>
      <label>界面语言 <select aria-label="界面语言" :value="appSetting['common.langId']" @change="save({ 'common.langId': $event.target.value })"><option value="zh-cn">简体中文</option><option value="en-us">English</option><option value="zh-tw">繁體中文</option></select></label>
      <p>按自己的习惯调整界面外观。</p>
    </template>
    <template v-else-if="section === 'playback'">
      <h2>播放</h2>
      <label>播放音质 <select aria-label="播放音质" :value="appSetting['player.playQuality']" @change="save({ 'player.playQuality': $event.target.value })"><option value="128k">标准</option><option value="320k">高品质</option><option value="flac">无损</option></select></label>
      <label>音量 <input aria-label="音量" type="range" min="0" max="1" step="0.05" :value="appSetting['player.volume']" @change="save({ 'player.volume': Number($event.target.value) })"></label>
      <p>支持跨平台自动切换。受浏览器限制，首次播放需要点击，可播放格式取决于浏览器支持。</p>
    </template>
    <template v-else>
      <h2>Web 能力说明</h2>
      <p>支持歌单、推荐、音乐库、音源、设置与下载。完成的下载会加入音乐库。</p>
      <p>平台账号支持官方扫码登录，各端连接同一服务即可共享歌单和个人推荐。桌面歌词和全局快捷键需在桌面应用使用。</p>
      <p>首页支持平台精选和每日推荐，歌单、音乐库与播放记录在各设备间保持一致。</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import themes from '@common/theme/index.json'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
defineProps<{ section: string }>()
const appearanceModes = [{ id: 'light', name: '浅色' }, { id: 'dark', name: '深色' }, { id: 'system', name: '跟随系统' }] as const
const save = (patch: Partial<LX.AppSetting>) => { void updateSetting(patch) }
</script>
<style module lang="less">
.panel { padding: 20px; line-height: 1.8; color: var(--color-font); h2 { font-size: 20px; } p { margin: 12px 0; } label { display: flex; gap: 16px; align-items: center; margin: 16px 0; } input, select, button { color: inherit; background: transparent; border: 1px solid currentColor; padding: 6px; border-radius: 5px; } select { max-width: 240px; } }
.panel { max-width: 800px; padding: 0; color: var(--tf-ink); h2 { font-size: 24px; line-height: 1.3; } h3 { margin: 32px 0 16px; font-size: 16px; font-weight: 500; } p { color: var(--tf-muted); font-size: 14px; } label { justify-content: space-between; min-height: 76px; border-bottom: 1px solid var(--tf-rule); margin: 0; font-size: 16px; } input,select { min-height: 40px; padding: 8px 12px; border: 1px solid var(--tf-muted); border-radius: 10px; background: var(--tf-surface); color: var(--tf-ink); font: inherit; font-size: 14px; } input[type=number] { width: 100px; } input[type=range] { padding: 0; accent-color: var(--tf-accent); } }
.panel input[type=number], .panel select { box-sizing: border-box; height: 40px; line-height: normal; }
.themeOptions { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; margin-bottom: 24px; button { padding: 16px; background: none; border: 1px solid var(--tf-rule); border-radius: var(--tf-radius); text-align: left; cursor: pointer; color: var(--tf-ink); font: inherit; &[aria-pressed=true] { border-color: var(--tf-accent); color: var(--tf-accent); } } }
.swatch { display: flex; flex-direction: column; gap: 8px; height: 68px; padding: 12px; margin-bottom: 12px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--tf-rule); i { display: block; width: 70%; height: 6px; border-radius: 3px; background: var(--tf-muted); &:first-child { width: 38%; background: var(--tf-accent); } } }
.light { background: var(--tf-theme-light); }
.dark { background: var(--tf-theme-dark); }
.system { background: linear-gradient(90deg,var(--tf-theme-light) 50%,var(--tf-theme-dark) 50%); }
@media(max-width: 760px) { .themeOptions { gap: 8px; button { padding: 8px; } } }
</style>
