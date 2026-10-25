<template>
  <section :class="$style.accounts">
    <h2>音乐平台账号</h2>
    <p>使用官方页面登录后，即可浏览账号歌单和个人推荐。导入只补充歌曲，保留已有内容。</p>
    <nav aria-label="音乐平台"><button v-for="(name, id) in accountNames" :key="id" :aria-pressed="provider === id" :disabled="busy" @click="select(id)">{{ name }} · {{ status?.[id] ? '已登录' : '未登录' }}</button></nav>
    <div :class="$style.actions">
      <button :disabled="busy" @click="login">{{ status?.[provider] ? '重新授权' : '登录' }} {{ accountNames[provider] }}</button>
      <button :disabled="busy" @click="refresh">刷新账号与歌单</button>
      <button :disabled="busy || !status?.[provider]" @click="useDaily">设为个人推荐来源</button>
      <button v-if="provider === 'tx'" :disabled="busy" @click="authorizeDaily">QQ 官方日推授权</button>
      <button v-if="provider === 'tx'" :disabled="busy" @click="transfer = true">连接 Android 账号</button>
      <button v-if="status?.[provider]" :disabled="busy" @click="logout">退出此平台账号</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <h3>账号歌单</h3><p v-if="!playlists.length && !busy">{{ status?.[provider] ? '暂无歌单，或平台暂不可用。' : '登录后查看创建和收藏的歌单。' }}</p>
    <ul :class="$style.playlists"><li v-for="playlist in playlists" :key="playlist.id"><span>{{ playlist.name }} · {{ playlist.trackCount }} 首</span><button :disabled="busy" @click="preview(playlist)">查看歌曲</button><button :disabled="busy" @click="importList(playlist)">导入歌单</button></li></ul>
    <router-link v-if="importedId" :to="`/list?id=${encodeURIComponent(importedId)}`">查看歌单 ›</router-link>
    <h3 v-if="previewTitle">{{ previewTitle }}</h3>
    <div v-if="tracks.length" :class="$style.tracks"><material-online-list :list="tracks" :page="1" :limit="tracks.length" :total="tracks.length" source-tag search-results play-in-context @play-list="play" /></div>
    <AccountTransferModal v-model:visible="transfer" />
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from '@common/utils/vueRouter'
import { getMusicAccountStatus, getMusicAccountPlaylists, loginMusicAccount, logoutMusicAccount, openQQDailyKeyPage, type MusicAccountProvider, type MusicAccountStatus, type MusicAccountPlaylist } from '@renderer/utils/ipc'
import AccountTransferModal from '@renderer/components/common/AccountTransferModal.vue'
import { dialog } from '@renderer/plugins/Dialog'
import { playFromPage } from '@renderer/core/player/selection'
import { accountNames, importDesktopAccountPlaylist, loadDesktopAccountPlaylist, notifyAccountsChanged } from './accounts'
const route = useRoute()
const initial = route.query.provider ?? localStorage.getItem('qmusic.dailyRecommend.provider')
const provider = ref<MusicAccountProvider>(initial === 'wy' || initial === 'kg' ? initial : 'tx')
const status = ref<MusicAccountStatus>()
const playlists = ref<MusicAccountPlaylist[]>([])
const tracks = ref<LX.Music.MusicInfoOnline[]>([])
const busy = ref(false)
const transfer = ref(false)
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
  const next = await getMusicAccountStatus()
  if (!active) return
  status.value = next; playlists.value = []; tracks.value = []; previewTitle.value = ''
  if (next[provider.value]) {
    const result = await getMusicAccountPlaylists(provider.value)
    if (!active) return
    if (result.status !== 'available') { error.value = `账号歌单暂不可用（${result.status}），请刷新或重新授权`; return }
    playlists.value = result.playlists
  }
}
const refresh = () => { void run(load) }
const select = (id: MusicAccountProvider) => { provider.value = id; importedId.value = ''; refresh() }
const login = () => { void run(async() => { const result = await loginMusicAccount(provider.value); await load(); notifyAccountsChanged(); message.value = result.status === 'connected' ? '已完成官方授权' : '已取消登录，现有数据保留' }) }
const logout = () => { void run(async() => { if (!await dialog.confirm({ message: '退出此平台账号？已导入的歌单与音乐文件会保留。' })) return; await logoutMusicAccount(provider.value); await load(); notifyAccountsChanged() }) }
const useDaily = () => { localStorage.setItem('qmusic.dailyRecommend.provider', provider.value); localStorage.setItem('qmusic.service.daily.mode.v1', 'account'); notifyAccountsChanged(); message.value = '首页已使用此账号的个人推荐' }
const authorizeDaily = () => { void run(async() => { const result = await openQQDailyKeyPage(); await load(); message.value = result.status === 'saved' ? 'QQ 官方日推已授权' : '日推专项授权未完成；已登录账号仍可使用雷达推荐'; notifyAccountsChanged() }) }
const preview = (playlist: MusicAccountPlaylist) => { void run(async() => { tracks.value = []; previewTitle.value = playlist.name; tracks.value = await loadDesktopAccountPlaylist(provider.value, playlist, () => !active) }) }
const importList = (playlist: MusicAccountPlaylist) => { void run(async() => { const result = await importDesktopAccountPlaylist(provider.value, playlist, () => !active); importedId.value = result.id; message.value = `已导入 ${result.count} 首歌曲，可在我的列表中查看` }) }
const play = (index: number) => { void playFromPage('account_preview', tracks.value, index).catch(() => { error.value = '播放失败，请检查音源设置' }) }
onMounted(refresh)
onBeforeUnmount(() => { active = false })
</script>
<style module lang="less">
.accounts { padding: 8px 0 24px; line-height: 1.6; h2 { font-size: 22px; margin-bottom: 12px; } p { font-size: 13px; margin: 12px 0; } h3 { margin: 20px 0 10px; } button { color: inherit; padding: 8px 14px; border: 1px solid currentColor; border-radius: 16px; background: transparent; cursor: pointer; margin: 4px 8px 4px 0; } button[aria-pressed=true] { color: var(--color-primary); } button:disabled { opacity: .4; cursor: default; } }
.actions { margin-top: 12px; }
.playlists { list-style: none; padding: 0; li { border-bottom: 1px solid var(--color-primary-light-100); padding: 10px 0; display: flex; align-items: center; gap: 10px; } span { flex: 1; } }
.tracks { height: 440px; margin-top: 12px; }
</style>
