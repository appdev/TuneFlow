<template>
  <section :class="$style.accounts">
    <h2>音乐平台账号</h2>
    <p :class="$style.subtitle">登录音乐平台，随时使用你的歌单与个人推荐。各端共享，导入保留已有内容。</p>
    <DeviceAccess @change="onAccess" />
    <template v-if="authorized">
    <nav :class="$style.providers" aria-label="音乐平台"><button v-for="(name, id) in accountNames" :key="id" :aria-pressed="provider === id" :disabled="busy" @click="select(id)"><strong>{{ name }}</strong><span>{{ status?.[id] ? '已登录' : '未登录' }}</span></button></nav>
    <section :class="$style.platform">
    <div :class="$style.platformHeading"><h3>{{ accountNames[provider] }}</h3><span :class="{ [$style.connected]: status?.[provider] }">{{ status?.[provider] ? '已登录 · 各端共享' : '尚未登录' }}</span></div>
    <p :class="$style.subtitle">{{ status?.[provider] ? '账号歌单和个人推荐已就绪，可在其他已解锁的应用中继续使用。' : '使用官方应用扫码登录，已有歌单和音乐不会受到影响。' }}</p>
    <div :class="$style.actions">
      <button :class="{ [$style.primary]: !status?.[provider] }" :disabled="busy" @click="login">{{ status?.[provider] ? '重新登录' : '扫码登录' }}</button>
      <button :disabled="busy" @click="refresh">刷新账号与歌单</button>
      <button :disabled="busy || !status?.[provider]" @click="useDaily">设为个人推荐来源</button>
    </div>
    <AccountLogin :provider="provider" :visible="qrLogin" @close="qrLogin = false" @connected="onConnected" />
    <details :key="provider" :class="$style.more">
      <summary>更多选项</summary>
      <div :class="$style.actions">
      <button v-if="!isServerBoundWeb" :disabled="busy" @click="nativeLogin">使用官方窗口授权</button>
      <button v-if="!isServerBoundWeb" :disabled="busy" @click="publishLocal">共享本机已登录账号</button>
      <button v-if="provider === 'tx' && !isServerBoundWeb" :disabled="busy" @click="authorizeDaily">QQ 官方日推授权</button>
    </div>
    <form v-if="provider === 'tx' && status?.tx" @submit.prevent="saveDailyKey">
      <h3>QQ 官方日推授权</h3><p>可在 <a href="https://y.qq.com/n/ryqq_v2/qqmusic_skills" target="_blank" rel="noopener noreferrer">QQ 官方授权页</a> 获取专用授权码。不设置时使用账号雷达推荐。</p>
      <label>专用授权码 <input v-model="dailyKey" type="password" autocomplete="off" spellcheck="false" maxlength="1100"></label><button :disabled="busy || !dailyKey">保存并共享日推授权</button>
    </form>
    <div v-if="status?.[provider]" :class="$style.logout"><p>退出平台账号会同时影响各端；已导入的歌单和下载文件仍会保留。</p><button :disabled="busy" @click="logout">退出此平台账号</button></div>
    <p v-if="isServerBoundWeb && !status?.[provider]" :class="$style.subtitle">请使用上方扫码登录。也可在桌面或 Android 的官方登录页完成授权后共享账号。</p>
    </details>
    </section>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <div :class="$style.listHeading"><h3>账号歌单</h3><span>{{ playlists.length }} 个歌单</span><span v-if="busy" role="status">正在加载…</span></div><p v-if="!playlists.length && !busy" :class="$style.subtitle">{{ status?.[provider] ? '暂无歌单，或平台暂不可用，请尝试刷新。' : '登录后，创建和收藏的歌单会显示在这里。' }}</p>
    <ul :class="$style.playlists"><li v-for="playlist in playlists" :key="playlist.id"><span :class="$style.playlistCopy"><span :class="$style.playlistName">{{ playlist.name }}</span><span :class="$style.playlistCount">{{ playlist.trackCount }} 首</span></span><button :disabled="busy" @click="preview(playlist)">查看歌曲</button><button :disabled="busy" @click="importList(playlist)">导入歌单</button></li></ul>
    <router-link v-if="importedId" :to="`/list?id=${encodeURIComponent(importedId)}`">查看歌单 ›</router-link>
    <h3 v-if="previewTitle">{{ previewTitle }}</h3>
    <div v-if="tracks.length" :class="$style.tracks"><material-online-list :list="tracks" :page="1" :limit="tracks.length" :total="tracks.length" source-tag search-results play-in-context @play-list="play" /></div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from '@common/utils/vueRouter'
import { getMusicAccountStatus, getMusicAccountPlaylists, loginMusicAccount, publishMusicAccount, openQQDailyKeyPage, type MusicAccountProvider, type MusicAccountStatus, type MusicAccountPlaylist } from '@renderer/utils/ipc'
import DeviceAccess from './DeviceAccess.vue'
import AccountLogin from './AccountLogin.vue'
import { getWorkspace, isServerBoundWeb } from './session'
import { dialog } from '@renderer/plugins/Dialog'
import { playFromPage } from '@renderer/core/player/selection'
import { accountNames, importDesktopAccountPlaylist, loadDesktopAccountPlaylist, notifyAccountsChanged, sharedAccounts } from './accounts'
const route = useRoute()
const initial = route.query.provider ?? localStorage.getItem('qmusic.dailyRecommend.provider')
const provider = ref<MusicAccountProvider>(initial === 'wy' || initial === 'kg' ? initial : 'tx')
const status = ref<MusicAccountStatus>()
const playlists = ref<MusicAccountPlaylist[]>([])
const tracks = ref<LX.Music.MusicInfoOnline[]>([])
const busy = ref(false)
const authorized = ref(false)
const qrLogin = ref(false)
const dailyKey = ref('')
const error = ref('')
const message = ref('')
const importedId = ref('')
const previewTitle = ref('')
let active = true
const run = async(action: () => Promise<unknown>) => {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (e) { if (active) error.value = e instanceof Error ? e.message : '账号操作失败' } finally { busy.value = false }
}
const load = async() => {
  const workspace = getWorkspace(); const selected = provider.value
  const next = await getMusicAccountStatus()
  if (!active || workspace !== getWorkspace() || provider.value !== selected || !authorized.value) return
  status.value = next; playlists.value = []; tracks.value = []; previewTitle.value = ''
  if (next[provider.value]) {
    const result = await getMusicAccountPlaylists(provider.value)
    if (!active || workspace !== getWorkspace() || provider.value !== selected || !authorized.value) return
    if (result.status !== 'available') { error.value = `账号歌单暂不可用（${result.status}），请刷新或重新授权`; return }
    playlists.value = result.playlists
  }
}
const refresh = () => { void run(load) }
const select = (id: MusicAccountProvider) => { qrLogin.value = false; provider.value = id; importedId.value = ''; refresh() }
const login = () => { qrLogin.value = false; void Promise.resolve().then(() => { qrLogin.value = true }) }
const onAccess = (value: boolean) => { const changed = authorized.value !== value; authorized.value = value; if (value && changed) refresh(); else if (!value) { qrLogin.value = false; status.value = undefined; playlists.value = []; tracks.value = []; importedId.value = ''; previewTitle.value = ''; message.value = ''; error.value = '' } }
const onConnected = () => { notifyAccountsChanged(); refresh() }
const publishLocal = () => { void run(async() => { await publishMusicAccount(provider.value); await load(); notifyAccountsChanged(); message.value = '账号已共享，其他已授权设备可以使用' }) }
const nativeLogin = () => { void run(async() => { const result = await loginMusicAccount(provider.value); if (result.status === 'connected') { await publishMusicAccount(provider.value); await load(); notifyAccountsChanged(); message.value = '已完成官方授权并共享账号' } else message.value = '已取消登录，现有数据保留' }) }
const logout = () => { void run(async() => { if (!await dialog.confirm({ message: '退出共享平台账号？所有已授权设备都将停止使用此授权，已导入的歌单与音乐文件会保留。' })) return; const api = sharedAccounts(getWorkspace().client); const current = await api.status(); await api.logout(provider.value, current.revisions[provider.value]); await load(); notifyAccountsChanged() }) }
const useDaily = () => { localStorage.setItem('qmusic.dailyRecommend.provider', provider.value); localStorage.setItem('qmusic.service.daily.mode.v1', 'account'); notifyAccountsChanged(); message.value = '首页已使用此账号的个人推荐' }
const authorizeDaily = () => { void run(async() => { const result = await openQQDailyKeyPage(); if (result.status === 'saved') await publishMusicAccount('tx'); await load(); message.value = result.status === 'saved' ? 'QQ 官方日推已授权并共享' : '日推专项授权未完成；已登录账号仍可使用雷达推荐'; notifyAccountsChanged() }) }
const saveDailyKey = () => { void run(async() => { const api = sharedAccounts(getWorkspace().client); const current = await api.status(); await api.authorizeDaily(dailyKey.value.trim(), current.revisions.tx); dailyKey.value = ''; await load(); notifyAccountsChanged(); message.value = 'QQ 官方日推授权已共享' }) }
const preview = (playlist: MusicAccountPlaylist) => { void run(async() => { tracks.value = []; previewTitle.value = playlist.name; tracks.value = await loadDesktopAccountPlaylist(provider.value, playlist, () => !active) }) }
const importList = (playlist: MusicAccountPlaylist) => { void run(async() => { const result = await importDesktopAccountPlaylist(provider.value, playlist, () => !active); importedId.value = result.id; message.value = `已导入 ${result.count} 首歌曲，可在我的列表中查看` }) }
const play = (index: number) => { void playFromPage('account_preview', tracks.value, index).catch(() => { error.value = '播放失败，请检查音源设置' }) }
onMounted(() => { window.addEventListener('qmusic-accounts-changed', accountChanged) })
const accountChanged = () => { if (authorized.value && !busy.value) refresh() }
onBeforeUnmount(() => { active = false; dailyKey.value = ''; window.removeEventListener('qmusic-accounts-changed', accountChanged) })
</script>
<style module lang="less">
.accounts { max-width: 1080px; padding: 8px 4px 32px; line-height: 1.6; h2 { font-size: 24px; margin-bottom: 8px; } p { font-size: 13px; margin: 12px 0; } h3 { font-size: 16px; margin: 0; } button { color: inherit; padding: 8px 14px; min-height: 36px; border: 1px solid var(--q-outline); border-radius: 8px; background: var(--q-surface-soft); cursor: pointer; font: inherit; font-size: 13px; } button:hover:enabled { background: var(--q-surface-strong); border-color: var(--color-primary); } button:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; } button:disabled { opacity: .45; cursor: default; } input { color: inherit; border: 1px solid var(--q-outline); border-radius: 8px; padding: 8px; background: var(--q-surface); margin: 0 10px; } }
.subtitle { color: var(--color-font-label); }
.providers { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; button { display: flex; align-items: center; gap: 18px; padding: 12px 16px; min-width: 180px; text-align: left; } span { font-size: 12px; color: var(--color-font-label); } button[aria-pressed=true] { color: var(--color-primary); background: var(--q-surface-strong); border-color: var(--color-primary); } }
.platform { border: 1px solid var(--q-outline); border-radius: 16px; padding: 22px; background: var(--q-surface-soft); }
.platformHeading, .listHeading { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; span { color: var(--color-font-label); font-size: 12px; } .connected { color: var(--color-primary); } }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.primary { background: var(--color-primary) !important; color: var(--color-primary-light-1000) !important; border-color: transparent !important; }
.more { border-top: 1px solid var(--q-outline); margin-top: 20px; padding-top: 14px; summary { cursor: pointer; font-size: 13px; color: var(--color-font-label); } h3 { margin-top: 18px; } }
.logout { border-top: 1px solid var(--q-outline); margin-top: 18px; padding-top: 4px; }
.listHeading { margin: 26px 0 12px; }
.playlists { list-style: none; padding: 0; margin: 0; li { border-bottom: 1px solid var(--q-outline); padding: 14px 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; } }
.playlistCopy { display: flex; flex: 1; min-width: 160px; flex-direction: column; gap: 3px; }
.playlistName { color: var(--q-list-text); font-size: var(--q-list-title-size); font-weight: 400; overflow-wrap: anywhere; }
.playlistCount { color: var(--q-list-muted); font-size: var(--q-list-detail-size); }
.tracks { height: 440px; margin-top: 12px; }
</style>
