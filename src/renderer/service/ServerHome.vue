<template>
  <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut">
    <div v-show="props.visible" :class="$style.noitem">
      <transition
        mode="out-in"
        :enter-active-class="$style.panelEnterActive" :leave-active-class="$style.panelLeaveActive"
        :enter-from-class="isShowDailyDetail ? $style.panelFromRight : $style.panelFromLeft"
        :leave-to-class="$style.panelFade"
      >
        <div v-if="!isShowDailyDetail" class="scroll" :class="$style.noitemShell">
          <header :class="$style.welcomeBar">
            <div :class="$style.welcomeCopy">
              <span :class="$style.greetingTag">{{ $t('search__home_eyebrow') }}</span>
              <h2>{{ $t('search__welcome') }}</h2>
              <p>{{ $t('search__welcome_subtitle') }}</p>
            </div>
            <button type="button" :class="[$style.syncAction, { [$style.connected]: hasMusicAccount }]" @click="openAccountModal">
              <span :class="$style.accountIcons">
                <source-icon v-if="accountStatus.accounts.tx.hasSession" source="tx" :size="20" />
                <source-icon v-if="accountStatus.accounts.wy.hasSession" source="wy" :size="20" />
                <source-icon v-if="accountStatus.accounts.kg.hasSession" source="kg" :size="20" />
                <svg-icon v-if="!hasMusicAccountSession" name="headphones" />
              </span>
              <span>{{ accountActionText }}</span>
              <b aria-hidden="true">›</b>
            </button>
          </header>

          <nav :class="$style.recommendProviders" :aria-label="$t('search__recommend_provider')">
            <span>{{ $t('search__recommend_provider') }}</span>
            <button
              v-for="provider in accountProviderOptions" :key="provider.id" type="button"
              :aria-pressed="selectedDailyProvider == provider.id" :class="{ [$style.providerSelected]: selectedDailyProvider == provider.id }"
              @click="selectDailyProvider(provider.id)"
            >
              <source-icon v-if="provider.id != 'server'" :source="provider.id" :size="18" />{{ provider.name || $t(provider.nameKey) }}
            </button>
          </nav>
          <div :class="$style.featureGrid">
            <section
              :class="$style.dailyCard" role="button" tabindex="0"
              :aria-label="$t('search__daily_open')" @click="openDailyDetail"
              @keydown.enter="openDailyDetail" @keydown.space.prevent="openDailyDetail"
            >
              <div :class="$style.dailyCover" aria-hidden="true">
                <div v-for="index in 4" :key="index" :class="$style.coverTile">
                  <img v-if="dailyCoverUrls[index - 1]" :class="$style.fadeImg" :src="dailyCoverUrls[index - 1]" alt="" @load="handleCoverLoad" @error="handleDailyCoverError(index - 1)">
                  <svg-icon v-else name="music" />
                </div>
                <div :class="$style.dateBadge">
                  <strong>{{ todayDay }}</strong>
                  <span>{{ todayMonth }}</span>
                </div>
              </div>
              <div :class="$style.dailyContent">
                <div :class="$style.dailySourceRow">
                  <span :class="$style.eyebrow">{{ $t('search__daily_eyebrow') }}</span>
                </div>
                <h3>{{ dailyTitle }}</h3>
                <p>{{ dailyRecommendMode == 'personalized' ? $t('search__daily_personalized_desc') : '根据服务器收藏、歌单和播放偏好推荐，播放由 Docker 提供。' }}</p>
                <p :class="[$style.sourceStatus, { [$style.personalized]: dailyRecommendMode == 'personalized' }]">
                  <source-icon v-if="selectedDailyProvider != 'server'" :source="selectedDailyProvider" :size="15" />{{ dailySourceText }}
                </p>
                <p v-if="dailyError" role="alert">{{ dailyError }}</p>
                <ol v-if="dailyRecommendList.length" :class="$style.trackPreview">
                  <li v-for="item in dailyRecommendList.slice(0, 3)" :key="item.id"><strong>{{ item.name }}</strong><span>{{ item.singer }}</span></li>
                </ol>
                <ol v-else-if="isDailyLoading" :class="[$style.trackPreview, $style.trackPreviewSkeleton]" :aria-label="$t('search__daily_recommend_loading')">
                  <li v-for="index in 3" :key="index"><i /><i /></li>
                </ol>
                <div v-else :class="$style.dailyLoading">{{ $t('search__daily_recommend_empty') }}</div>
                <div :class="$style.dailyActions">
                  <button type="button" :disabled="!dailyRecommendList.length" @click.stop="playDailyRecommend()">{{ $t('search__daily_recommend_play') }}</button>
                  <button type="button" :disabled="isDailyLoading" @click.stop="loadDailyRecommend(true)">{{ $t('search__daily_recommend_refresh') }}</button>
                  <span :class="$style.openHint">{{ $t('search__daily_open') }} ›</span>
                </div>
              </div>
            </section>
          </div>

          <section v-if="dailyRecommendList.length" :class="$style.playlistShelf">
            <header>
              <div>
                <h3>{{ $t('search__today_discovery') }}</h3>
                <p>{{ $t('search__today_discovery_desc') }}</p>
              </div>
            </header>
            <div :class="[$style.playlistRail, $style.discoveryGrid]">
              <button v-for="(item, index) in dailyRecommendList.slice(0, 9)" :key="`${item.source}_${item.id}`" type="button" @click="playDailyRecommend(index)">
                <span :class="$style.playlistCover">
                  <img v-if="dailyCoverUrls[index] || item.meta.picUrl" :class="$style.fadeImg" :src="dailyCoverUrls[index] || item.meta.picUrl" alt="" @load="handleCoverLoad">
                  <svg-icon v-else name="music" />
                  <i>▶</i>
                </span>
                <strong :title="item.name">{{ item.name }}</strong>
                <small :title="item.singer">{{ item.singer }}</small>
              </button>
            </div>
          </section>

          <section v-if="accountStatus[accountPlaylistsProvider]" :class="$style.playlistShelf">
            <header>
              <div>
                <h3>{{ $t('search__provider_playlists', { name: $t(accountProviderOptions.find(item => item.id == accountPlaylistsProvider)?.nameKey || 'search__account_playlists') }) }}</h3>
                <p>{{ $t('search__account_playlists_desc') }}</p>
              </div>
              <button type="button" :disabled="isPlaylistsLoading" @click="loadAccountPlaylists(true, accountPlaylistsProvider)">
                {{ isPlaylistsLoading ? $t('search__account_playlists_loading') : $t('search__hot_search_refresh') }}
              </button>
            </header>
            <button type="button" :class="$style.libraryImportButton" @click="openAccountImport(accountPlaylistsProvider)">{{ $t('search__account_import') }} ›</button>
            <div v-if="accountPlaylists.length" :class="$style.playlistRail">
              <button v-for="playlist in accountPlaylists" :key="playlist.id" type="button" @click="openAccountPlaylist(playlist)">
                <span :class="$style.playlistCover">
                  <img v-if="playlist.cover" :class="$style.fadeImg" :src="playlist.cover" alt="" @load="handleCoverLoad">
                  <svg-icon v-else name="music" />
                  <i>▶</i>
                </span>
                <strong :title="playlist.name">{{ playlist.name }}</strong>
                <small>{{ $t('search__daily_count', { count: playlist.trackCount }) }}</small>
              </button>
            </div>
            <div v-else-if="isPlaylistsLoading" :class="[$style.playlistRail, $style.playlistSkeleton]" :aria-label="$t('search__account_playlists_loading')">
              <div v-for="index in 5" :key="index"><i /><b /><b /></div>
            </div>
            <div v-else-if="accountPlaylistsError" :class="$style.playlistEmpty" role="status">
              <p>{{ $t(accountPlaylistsError == 'login_required' ? 'search__account_expired' : accountPlaylistsError == 'verification_required' ? 'kugou__verification_required' : 'list__load_failed') }}</p>
              <base-btn min @click="accountPlaylistsError == 'login_required' ? openAccountModal() : loadAccountPlaylists(true, accountPlaylistsProvider)">{{ $t(accountPlaylistsError == 'login_required' ? 'search__account_manage' : 'search__retry') }}</base-btn>
            </div>
            <p v-else :class="$style.playlistEmpty">{{ $t('search__account_playlists_empty') }}</p>
          </section>

        </div>
        <div v-else :class="$style.dailyDetail">
          <header :class="$style.detailHeader">
            <button type="button" :class="$style.backButton" :aria-label="$t('back')" @click="closeDailyDetail">‹</button>
            <div :class="$style.detailCover" aria-hidden="true">
              <img v-if="detailCover" :class="$style.fadeImg" :src="detailCover" alt="" @load="handleCoverLoad">
              <svg-icon v-else name="music" />
            </div>
            <div :class="$style.detailCopy">
              <span :class="$style.eyebrow">{{ detailEyebrow }}</span>
              <h2>{{ detailTitle }}</h2>
              <p>{{ detailSubtitle }}</p>
              <p :class="$style.detailSource">
                <source-icon v-if="detailProvider != 'server'" :source="detailProvider" :size="15" />
                <span v-if="detailSourceText">{{ detailSourceText }}</span>
              </p>
            </div>
            <div :class="$style.detailActions">
              <button v-if="detailKind == 'playlist'" type="button" :disabled="importing" @click="importSelectedPlaylist">{{ importing ? '正在导入…' : '导入服务器' }}</button>
              <base-btn min :disabled="!detailMusicList.length" @click="playDetailList()">{{ $t('search__daily_recommend_play') }}</base-btn>
              <base-btn v-if="detailKind == 'daily'" min :disabled="isDailyLoading" @click="loadDailyRecommend(true)">{{ $t('search__daily_recommend_refresh') }}</base-btn>
              <base-btn v-else min :disabled="isPlaylistDetailLoading" @click="openAccountPlaylist(selectedAccountPlaylist)">{{ $t('search__daily_recommend_refresh') }}</base-btn>
            </div>
          </header>
          <p v-if="detailKind == 'daily' ? dailyError : playlistDetailError" role="alert">{{ detailKind == 'daily' ? dailyError : playlistDetailError }}</p>
          <p v-if="importMessage" role="status">{{ importMessage }}</p>
          <div :class="$style.detailList">
            <div :class="$style.detailTableHeader" aria-hidden="true">
              <span>#</span><span>{{ $t('music_name') }}</span><span>{{ $t('music_singer') }}</span><span>{{ $t('music_album') }}</span><span>{{ $t('music_time') }}</span><span />
            </div>
            <ol v-if="detailMusicList.length" class="scroll" :class="$style.detailTracks">
              <li v-for="(item, index) in detailMusicList" :key="`${item.source}_${item.id}`" :class="{ [$style.currentTrack]: isCurrentTrack(item) }" @dblclick="playDetailList(index)">
                <span :class="$style.trackNumber">
                  <span v-if="isCurrentTrack(item)" :class="[$style.playingBars, { [$style.playingBarsPaused]: !isPlay }]" aria-hidden="true"><i /><i /><i /></span>
                  <template v-else>{{ String(index + 1).padStart(2, '0') }}</template>
                </span>
                <strong :title="item.name">{{ item.name }}</strong>
                <span :title="item.singer">{{ item.singer }}</span>
                <span :title="item.meta.albumName">{{ item.meta.albumName || '—' }}</span>
                <span :class="$style.trackDuration">{{ item.interval || '—' }}</span>
                <button type="button" :aria-label="isCurrentTrack(item) && isPlay ? $t('player__pause') : $t('list__play')" @click="playDetailList(index)">{{ isCurrentTrack(item) && isPlay ? '❚❚' : '▶' }}</button>
              </li>
            </ol>
            <ol v-else-if="isDetailLoading" :class="$style.detailTracksSkeleton" :aria-label="detailEmptyText">
              <li v-for="index in 8" :key="index"><i /><i /><i /><i /><i /></li>
            </ol>
            <p v-else :class="$style.detailEmpty">{{ detailEmptyText }}</p>
          </div>
        </div>
      </transition>
    </div>
  </transition>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { useRouter } from '@common/utils/vueRouter'
import { getMusicAccountPlaylists, getMusicAccountStatus, type MusicAccountProvider, type MusicAccountPlaylist, type MusicAccountStatus } from '@renderer/utils/ipc'
import SourceIcon from '@renderer/components/common/SourceIcon.vue'
import { getPicPath } from '@renderer/core/music'
import { playFromPage } from '@renderer/core/player/selection'
import { togglePlay } from '@renderer/core/player/action'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { getWorkspace, serviceStatus, subscribeService, subscribeRecommendations } from './session'
import { loadDesktopAccountDaily, loadDesktopAccountPlaylist, importDesktopAccountPlaylist, accountNames } from './accounts'
import { loadDailyFeed, dailyFeedNotice, dailyKindNames, type DailySource, type DailyFeed } from './recommendations'
import { ServiceError } from './client'
const props = withDefaults(defineProps<{ visible?: boolean, source?: string }>(), { visible: true, source: '' })
const router = useRouter()
const saved = localStorage.getItem('qmusic.dailyRecommend.provider')
const isWeb = String(process.platform) === 'web'
const selectedDailyProvider = ref<DailySource>(isWeb || localStorage.getItem('qmusic.service.daily.mode.v1') === 'server' ? 'server' : saved === 'wy' || saved === 'kg' ? saved : 'tx')
const accountProviderOptions = ([{ id: 'tx', nameKey: 'search__account_qq', name: '' }, { id: 'wy', nameKey: 'search__account_netease', name: '' }, { id: 'kg', nameKey: 'source_kg', name: '' }, { id: 'server', nameKey: '', name: 'Docker 推荐' }] as const).filter(provider => !isWeb || provider.id === 'server')
const dailyRecommendList = shallowRef<LX.Music.MusicInfoOnline[]>([])
const dailyCoverUrls = ref<string[]>([])
const feed = shallowRef<DailyFeed>()
const isDailyLoading = ref(false)
const dailyError = ref('')
const isShowDailyDetail = ref(false)
const detailKind = ref('daily')
const profile = () => ({ state: 'disconnected' as const, displayName: '', avatar: '', accountHint: '', hasSession: false })
const accountStatus = shallowRef<MusicAccountStatus>({ tx: false, wy: false, kg: false, accounts: { tx: profile(), wy: profile(), kg: profile() } })
const accountPlaylistsProvider = ref<MusicAccountProvider>('tx')
const accountPlaylists = shallowRef<MusicAccountPlaylist[]>([])
const accountPlaylistsError = ref('')
const isPlaylistsLoading = ref(false)
const selectedAccountPlaylist = shallowRef<MusicAccountPlaylist>()
const selectedAccountPlaylistProvider = ref<MusicAccountProvider>('tx')
const playlistDetailList = shallowRef<LX.Music.MusicInfoOnline[]>([])
const isPlaylistDetailLoading = ref(false)
const playlistDetailError = ref('')
const importing = ref(false)
const importMessage = ref('')
const now = ref(new Date())
const todayDay = computed(() => String(now.value.getDate()).padStart(2, '0'))
const todayMonth = computed(() => new Intl.DateTimeFormat(window.i18n.locale || 'zh-CN', { month: 'short' }).format(now.value))
const todayLabel = computed(() => new Intl.DateTimeFormat(window.i18n.locale || 'zh-CN', { month: 'long', day: 'numeric' }).format(now.value))
const hasMusicAccount = computed(() => accountStatus.value.tx || accountStatus.value.wy || accountStatus.value.kg)
const hasMusicAccountSession = computed(() => Object.values(accountStatus.value.accounts).some(account => account.hasSession))
const accountActionText = computed(() => isWeb ? '平台账号 · 客户端功能说明' : hasMusicAccount.value ? '音乐账号已登录 · 管理账号' : '登录音乐平台')
const dailyRecommendMode = computed(() => feed.value?.origin === 'account' ? 'personalized' : 'fallback')
const dailyTitle = computed(() => `${dailyKindNames[feed.value?.kind ?? ''] ?? (selectedDailyProvider.value === 'server' ? 'Docker 每日推荐' : accountNames[selectedDailyProvider.value] + '个人推荐')} · ${dailyRecommendList.value.length} 首`)
const dailySourceText = computed(() => isDailyLoading.value && !feed.value ? '正在加载推荐…' : feed.value ? dailyFeedNotice(feed.value) : '个人推荐不可用时自动使用 Docker 推荐')
const detailMusicList = computed(() => detailKind.value === 'playlist' ? playlistDetailList.value : dailyRecommendList.value)
const detailTitle = computed(() => detailKind.value === 'playlist' ? selectedAccountPlaylist.value?.name : dailyTitle.value)
const detailCover = computed(() => detailKind.value === 'playlist' ? selectedAccountPlaylist.value?.cover : dailyCoverUrls.value[0])
const detailEyebrow = computed(() => detailKind.value === 'playlist' ? '账号歌单' : 'DAILY MIX')
const detailSubtitle = computed(() => `${todayLabel.value} · ${detailMusicList.value.length} 首`)
const detailProvider = computed(() => detailKind.value === 'playlist' ? selectedAccountPlaylistProvider.value : selectedDailyProvider.value)
const detailSourceText = computed(() => detailKind.value === 'playlist' ? selectedAccountPlaylist.value?.creator : dailySourceText.value)
const isDetailLoading = computed(() => detailKind.value === 'playlist' ? isPlaylistDetailLoading.value : isDailyLoading.value)
const detailEmptyText = computed(() => isDetailLoading.value ? '正在加载…' : '暂无歌曲，请刷新重试')
let active = true
let dailyRevision = 0
let playlistRevision = 0
let detailRevision = 0
let statusRevision = 0
let shownSource: DailySource | undefined
let controller: AbortController | undefined
let pendingUpdate = false
let endpoint = ''
const loadDailyRecommend = async(force = false) => {
  if (!active || !props.visible) return
  controller?.abort()
  const request = controller = new AbortController()
  const revision = ++dailyRevision
  const source = selectedDailyProvider.value
  const workspace = getWorkspace()
  endpoint = workspace.client.endpoint
  now.value = new Date(); isDailyLoading.value = true; dailyError.value = ''
  if (shownSource !== source) { dailyRecommendList.value = []; dailyCoverUrls.value = []; feed.value = undefined }
  try {
    const next = await loadDailyFeed(workspace, source, loadDesktopAccountDaily, force, request.signal)
    if (!active || revision !== dailyRevision || workspace !== getWorkspace()) return
    // The request revision and workspace above guard this assignment.
    // eslint-disable-next-line require-atomic-updates
    shownSource = source
    feed.value = next; dailyRecommendList.value = next.list
    dailyCoverUrls.value = next.list.slice(0, 9).map(item => item.meta.picUrl ?? '')
    const covers = await Promise.all(next.list.slice(0, 9).map(async item => item.meta.picUrl ?? await getPicPath({ musicInfo: item }).catch(() => '')))
    if (active && revision === dailyRevision && workspace === getWorkspace()) dailyCoverUrls.value = covers
  } catch (error) {
    if (active && revision === dailyRevision) {
      if (error instanceof ServiceError && error.code === 'ACCOUNT_CHANGED') {
        dailyRecommendList.value = []; dailyCoverUrls.value = []; feed.value = undefined
      }
      dailyError.value = error instanceof Error ? error.message : '推荐加载失败，请重试'
    }
  } finally {
    if (revision === dailyRevision) { isDailyLoading.value = false; if (pendingUpdate) { pendingUpdate = false; void loadDailyRecommend() } }
  }
}
const openAccountModal = () => { void router.push(`/setting?name=SettingAccounts&provider=${selectedDailyProvider.value === 'server' ? 'tx' : selectedDailyProvider.value}`) }
const openAccountImport = (provider: MusicAccountProvider) => { void router.push(`/setting?name=SettingAccounts&provider=${provider}`) }
const loadAccountPlaylists = async(force = false, provider = accountPlaylistsProvider.value) => {
  if (!accountStatus.value[provider] || (!force && accountPlaylistsProvider.value === provider && accountPlaylists.value.length)) return
  const revision = ++playlistRevision
  if (provider !== accountPlaylistsProvider.value) accountPlaylists.value = []
  accountPlaylistsProvider.value = provider; isPlaylistsLoading.value = true; accountPlaylistsError.value = ''
  try {
    const result = await getMusicAccountPlaylists(provider)
    if (!active || revision !== playlistRevision) return
    if (result.status === 'available') accountPlaylists.value = result.playlists
    else accountPlaylistsError.value = result.status
  } catch { if (active && revision === playlistRevision) accountPlaylistsError.value = 'unavailable' } finally { if (revision === playlistRevision) isPlaylistsLoading.value = false }
}
const refreshAccountStatus = async() => {
  const revision = ++statusRevision
  const status = await getMusicAccountStatus().catch(() => undefined)
  if (!active || revision !== statusRevision || !status) return
  accountStatus.value = status
  const selected = selectedDailyProvider.value
  const provider = selected !== 'server' && status[selected] ? selected : (['tx', 'wy', 'kg'] as const).find(provider => status[provider])
  if (provider) void loadAccountPlaylists(false, provider)
  else { playlistRevision++; accountPlaylists.value = [] }
}
const openAccountPlaylist = async(playlist?: MusicAccountPlaylist) => {
  if (!playlist) return
  const revision = ++detailRevision
  const provider = accountPlaylistsProvider.value
  selectedAccountPlaylist.value = playlist; selectedAccountPlaylistProvider.value = provider
  playlistDetailList.value = []; playlistDetailError.value = ''; importMessage.value = ''
  detailKind.value = 'playlist'; isShowDailyDetail.value = true; isPlaylistDetailLoading.value = true
  try {
    const tracks = await loadDesktopAccountPlaylist(provider, playlist, () => !active || revision !== detailRevision)
    if (active && revision === detailRevision) playlistDetailList.value = tracks
  } catch { if (active && revision === detailRevision) playlistDetailError.value = '歌单加载失败，请刷新或检查账号状态' } finally { if (revision === detailRevision) isPlaylistDetailLoading.value = false }
}
const importSelectedPlaylist = async() => {
  if (!selectedAccountPlaylist.value || importing.value) return
  const revision = detailRevision
  importing.value = true
  try {
    const result = await importDesktopAccountPlaylist(selectedAccountPlaylistProvider.value, selectedAccountPlaylist.value, () => !active || revision !== detailRevision)
    if (active && revision === detailRevision) importMessage.value = `已导入 ${result.count} 首，服务器已有内容保留`
  } catch { if (active && revision === detailRevision) playlistDetailError.value = '导入失败，请检查账号和服务器连接' } finally { importing.value = false }
}
const selectDailyProvider = (source: DailySource) => {
  selectedDailyProvider.value = source; localStorage.setItem('qmusic.service.daily.mode.v1', source === 'server' ? 'server' : 'account')
  if (source !== 'server') localStorage.setItem('qmusic.dailyRecommend.provider', source)
  isShowDailyDetail.value = false; detailRevision++; void loadDailyRecommend()
  if (source !== 'server') void loadAccountPlaylists(false, source)
}
const isCurrentTrack = (track: LX.Music.MusicInfoOnline) => playMusicInfo.musicInfo?.id === track.id
const playTracks = async(tracks: LX.Music.MusicInfoOnline[], index = 0) => {
  if (!tracks.length) return
  try { await playFromPage(detailKind.value === 'playlist' ? 'account_preview' : 'service_daily', tracks, index) } catch { dailyError.value = '播放失败，请检查 Docker 音源设置' }
}
const playDailyRecommend = (index = 0) => { void playTracks(dailyRecommendList.value, index) }
const playDetailList = (index?: number) => { if (index != null && detailMusicList.value[index] && isCurrentTrack(detailMusicList.value[index])) togglePlay(); else void playTracks(detailMusicList.value, index) }
const openDailyDetail = () => { detailKind.value = 'daily'; importMessage.value = ''; isShowDailyDetail.value = true }
const closeDailyDetail = () => { isShowDailyDetail.value = false; detailRevision++ }
const handleCoverLoad = (event: Event) => { (event.target as HTMLImageElement).classList.add('q-cover-loaded') }
const handleDailyCoverError = (index: number) => { dailyCoverUrls.value[index] = '' }
const accountChanged = () => {
  shownSource = undefined; dailyRecommendList.value = []; dailyCoverUrls.value = []; feed.value = undefined
  playlistRevision++; detailRevision++; accountPlaylists.value = []; playlistDetailList.value = []; isShowDailyDetail.value = false
  const source = localStorage.getItem('qmusic.dailyRecommend.provider')
  if (localStorage.getItem('qmusic.service.daily.mode.v1') === 'account' && (source === 'tx' || source === 'wy' || source === 'kg')) selectedDailyProvider.value = source
  void refreshAccountStatus(); void loadDailyRecommend()
}
const update = () => { if (feed.value?.origin === 'account' || !props.visible) return; if (isDailyLoading.value) pendingUpdate = true; else void loadDailyRecommend() }
const unsubscribeRecommendations = subscribeRecommendations(update)
const unsubscribe = subscribeService(() => {
  if (!serviceStatus.connected || serviceStatus.busy) return
  if (endpoint !== serviceStatus.endpoint) { shownSource = undefined; dailyRecommendList.value = []; dailyCoverUrls.value = []; feed.value = undefined; void loadDailyRecommend() } else if (['warming', 'generating', 'stale'].includes(feed.value?.status ?? '') && !isDailyLoading.value) update()
})
window.addEventListener('qmusic-accounts-changed', accountChanged)
watch(() => props.visible, visible => { if (visible) { void refreshAccountStatus(); void loadDailyRecommend() } }, { immediate: true })
onBeforeUnmount(() => { active = false; dailyRevision++; playlistRevision++; detailRevision++; statusRevision++; controller?.abort(); unsubscribe(); unsubscribeRecommendations(); window.removeEventListener('qmusic-accounts-changed', accountChanged) })
</script>
<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.noitem {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: clamp(26px, 5vh, 58px) clamp(22px, 6vw, 82px) calc(@height-player + 18px);
}
.noitemShell {
  position: relative;
  width: min(1180px, 100%);
  max-height: 100%;
  display: flex;
  flex-flow: column nowrap;
  > * { flex-shrink: 0; }
  gap: 18px;
  overflow-y: auto;
  padding: 2px 8px 12px;
  box-sizing: border-box;
}
.welcomeBar {
  order: 0;
  min-height: 92px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 8px;
  color: var(--color-font);
}
.welcomeCopy {
  flex: 1;
  min-width: 0;

  h2 {
    margin: 5px 0 6px;
    font-size: 27px;
    line-height: 1.2;
    font-weight: 750;
    letter-spacing: -.02em;
    color: var(--color-font);
  }

  p {
    margin: 0;
    color: var(--color-font-label);
    font-size: 12px;
    line-height: 1.5;
  }
}
.greetingTag {
  color: var(--color-primary-dark-100);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.featureGrid {
  order: 2;
  display: block;
}
.dailyCard {
  min-width: 0;
  min-height: 282px;
  overflow: hidden;
  display: flex;
  gap: 26px;
  padding: 30px;
  box-sizing: border-box;
  border-radius: 16px;
  color: var(--color-font);
  background: linear-gradient(118deg, var(--color-primary-alpha-800), var(--q-surface-strong) 62%, transparent);
  border: 0;
  box-shadow: 0 12px 34px rgba(35, 54, 46, .1);
  cursor: pointer;
  outline: none;
  transition: transform @transition-fast, box-shadow @transition-fast, border-color @transition-fast;

  &:hover, &:focus-visible {
    transform: translateY(-2px);
    border-color: var(--color-primary-alpha-700);
    box-shadow: inset 0 1px 0 var(--q-border), 0 24px 54px rgba(35, 54, 46, .16);
  }

  &:active { transform: scale(.995); }
}
.dailyCover {
  position: relative;
  width: 210px;
  height: 210px;
  flex: none;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 3px;
  border-radius: 12px;
  background: var(--color-primary-alpha-900);
  box-shadow: 0 18px 38px rgba(35, 54, 46, .18), inset 0 0 0 1px var(--q-border);
}
.coverTile {
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  background: linear-gradient(145deg, var(--color-primary-alpha-900), var(--q-surface-strong));

  img { width: 100%; height: 100%; object-fit: cover; }
  :global(.svg-icon) { width: 24px; height: 24px; }
}
.dateBadge {
  position: absolute;
  inset: 50% auto auto 50%;
  width: 58px;
  height: 58px;
  transform: translate(-50%, -50%);
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: var(--color-font);
  background: var(--q-surface-strong);
  box-shadow: 0 10px 28px rgba(35, 54, 46, .2), inset 0 0 0 1px var(--q-border);
  backdrop-filter: blur(16px);

  strong { font-size: 20px; line-height: 1; }
  span { margin-top: 4px; color: var(--color-font-label); font-size: 9px; text-transform: uppercase; }
}
.dailyContent {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;

  h3 { margin: 5px 0 7px; font-size: 19px; font-weight: 760; }
  > p { margin: 0; color: var(--color-font-label); font-size: 12px; line-height: 1.55; }
}
.dailySourceRow {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dailyContent > .sourceStatus {
  margin-top: 7px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;

  &.personalized { color: var(--color-primary-dark-100); }
}
.eyebrow {
  color: var(--color-primary-dark-100);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .12em;
}
.trackPreview {
  min-width: 0;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;

  li { min-width: 0; display: flex; gap: 8px; padding: 3px 0; font-size: 11px; }
  strong, span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { max-width: 58%; font-weight: 620; }
  span { flex: 1; color: var(--color-font-label); }
}
.dailyActions {
  display: flex;
  gap: 9px;
  margin-top: 13px;

  button {
    min-height: 34px;
    padding: 0 14px;
    border: 0;
    border-radius: 12px;
    color: var(--color-primary-font);
    background: var(--color-primary-alpha-900);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    &:first-child { color: #fff; background: var(--color-primary); box-shadow: 0 8px 18px var(--color-primary-alpha-700); }
    &:disabled { cursor: default; opacity: .48; }
  }
}
.openHint {
  margin-left: auto;
  align-self: center;
  color: var(--color-primary-dark-100);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.dailyLoading {
  min-height: 42px;
  display: flex;
  align-items: center;
  color: var(--color-font-label);
  font-size: 12px;
}
.playlistShelf {
  order: 3;
  padding: 6px 4px 2px;

  > header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;

    h3 { margin: 0 0 5px; color: var(--color-font); font-size: 18px; }
    p { margin: 0; color: var(--color-font-label); font-size: 11px; }
    > button {
      padding: 6px 10px;
      border: 0;
      border-radius: 9px;
      color: var(--color-font-label);
      background: transparent;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      &:hover { color: var(--color-primary); background: transparent; }
    }
  }
}
.playlistRail {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;

  > button {
    min-width: 0;
    padding: 0;
    border: 0;
    color: var(--color-font);
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;

    &:hover .playlistCover { transform: translateY(-3px); box-shadow: 0 13px 25px rgba(35, 54, 46, .17); }
    &:hover .playlistCover i { opacity: 1; transform: translateY(0); }
    strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    strong { margin-top: 8px; font-size: 12px; font-weight: 620; }
    small { margin-top: 4px; color: var(--color-font-label); font-size: 10px; }
  }
}
.discoveryGrid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;

  > button {
    display: grid;
    // 列宽与封面使用同一 rem 尺寸，跟随界面字号一起缩放。
    grid-template-columns: 4.875rem minmax(0, 1fr);
    grid-template-rows: 1fr 1fr;
    column-gap: .75rem;
    align-items: center;
    padding: 8px;
    border-radius: 14px;
    background: var(--q-surface-soft);
    transition: background-color @transition-fast, transform @transition-fast, box-shadow @transition-fast;

    &:hover {
      transform: translateY(-2px);
      background: var(--q-surface-strong);
      box-shadow: 0 12px 26px rgba(35, 54, 46, .1);
    }

    .playlistCover {
      grid-column: 1;
      grid-row: 1 / 3;
      width: 100%;
      height: auto;
    }

    strong { grid-column: 2; min-width: 0; margin-top: auto; align-self: end; font-size: 12.5px; }
    small { grid-column: 2; min-width: 0; margin-bottom: auto; align-self: start; }
  }
}
.playlistCover {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--color-primary);
  background: var(--color-primary-alpha-900);
  transition: transform @transition-fast, box-shadow @transition-fast;

  img { width: 100%; height: 100%; object-fit: cover; }
  :global(.svg-icon) { width: 25px; height: 25px; }
  i {
    position: absolute;
    right: 10px;
    bottom: 10px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    background: var(--color-primary);
    box-shadow: 0 7px 16px rgba(0, 0, 0, .2);
    opacity: 0;
    transform: translateY(5px);
    transition: opacity @transition-fast, transform @transition-fast;
    font-size: 10px;
    font-style: normal;
  }
}
.playlistEmpty {
  margin: 0;
  padding: 20px;
  border-radius: 12px;
  color: var(--color-font-label);
  background: transparent;
  font-size: 11px;
  text-align: center;
}
.syncAction {
  height: 40px;
  padding: 0 10px 0 8px;
  border: 1px solid rgba(54, 83, 70, .12);
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--color-primary-dark-100);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  background: var(--q-surface);
  box-shadow: 0 8px 22px rgba(35, 54, 46, .08), inset 0 1px 0 var(--q-border);
  transition: transform @transition-fast, box-shadow @transition-fast, opacity @transition-fast;

  :global(.svg-icon) { width: 17px; height: 17px; }
  b { margin-left: 1px; font-size: 17px; font-weight: 500; opacity: .72; }

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 26px rgba(35, 54, 46, .13), inset 0 1px 0 var(--q-border);
  }

  &:active {
    transform: scale(.97);
    opacity: .86;
  }

  &.connected {
    color: #fff;
    border-color: transparent;
    background: var(--color-primary);
  }
}
.accountIcons {
  display: flex;
  align-items: center;

  > * {
    overflow: hidden;
    border: 2px solid var(--q-border);
    border-radius: 50%;
    background: #fff;
  }

  > * + * { margin-left: -6px; }
}

@media (max-width: 980px) {
  .discoveryGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.dailyDetail {
  width: min(1160px, 100%);
  height: 100%;
  min-height: 0;
  padding: 4px 8px 12px;
  box-sizing: border-box;
  display: flex;
  flex-flow: column nowrap;
}
.detailHeader {
  flex: none;
  min-height: 112px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 14px 20px;
}
.backButton {
  width: 38px;
  height: 38px;
  flex: none;
  border: 1px solid rgba(54, 83, 70, .12);
  border-radius: 13px;
  color: var(--color-font);
  background: var(--q-surface);
  cursor: pointer;
  font: inherit;
  font-size: 29px;
  line-height: 1;
}
.detailCover {
  width: 86px;
  height: 86px;
  flex: none;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 21px;
  color: var(--color-primary);
  background: var(--color-primary-alpha-900);
  box-shadow: 0 10px 26px rgba(35, 54, 46, .14);

  img { width: 100%; height: 100%; object-fit: cover; }
  :global(.svg-icon) { width: 25px; height: 25px; }
}
.detailCopy {
  min-width: 0;
  flex: 1;

  h2 { margin: 4px 0 5px; color: var(--color-font); font-size: 27px; }
  p { margin: 0; color: var(--color-font-label); font-size: 13px; }
}
.detailCopy > .detailSource {
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary-dark-100);
  font-size: 10px;
  font-weight: 650;
}
.detailActions {
  display: flex;
  gap: 9px;
}
.detailList {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-flow: column nowrap;
  border: 1px solid rgba(54, 83, 70, .11);
  border-radius: 22px;
  background: rgb(from var(--color-main-background) r g b / .46);
  box-shadow: inset 0 1px 0 var(--q-border), 0 14px 36px rgba(35, 54, 46, .08);
  backdrop-filter: blur(18px) saturate(1.12);
}
.detailTableHeader, .detailTracks li {
  display: grid;
  grid-template-columns: 42px minmax(210px, 1.55fr) minmax(130px, .82fr) minmax(160px, 1fr) 58px 42px;
  align-items: center;
  gap: 12px;
}
.detailTableHeader {
  flex: none;
  min-height: 46px;
  padding: 0 16px;
  color: var(--color-font-label);
  border-bottom: 1px solid rgba(54, 83, 70, .09);
  font-size: 12px;
}
.detailTracks {
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 7px 8px 12px;
  list-style: none;

  li {
    min-height: 56px;
    padding: 0 8px;
    border-radius: 13px;
    color: var(--color-font);
    font-size: 13px;
    transition: background-color @transition-fast;

    &:hover { background: transparent; }
    > strong, > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    > strong { font-weight: 650; }
    > span:not(.trackNumber) { color: var(--color-font-label); }
    > button {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 10px;
      color: var(--color-primary);
      background: var(--color-primary-alpha-900);
      cursor: pointer;
      font-size: 10px;
    }
  }
}
.trackNumber { color: var(--color-font-label); font-variant-numeric: tabular-nums; }
.detailTracks li.currentTrack {
  background: transparent;

  > strong { color: var(--color-primary-dark-100); }
  > button { color: #fff; background: var(--color-primary); }
}
.playingBars {
  height: 14px;
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;

  i {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: var(--color-primary);
    transform-origin: bottom;
    animation: q-daily-bars .9s ease-in-out infinite alternate;

    &:nth-child(2) { animation-delay: -.3s; }
    &:nth-child(3) { animation-delay: -.6s; }
  }
}
.playingBarsPaused i {
  animation-play-state: paused;
}
@keyframes q-daily-bars {
  from { transform: scaleY(.3); }
  to { transform: scaleY(1); }
}
.trackDuration { font-variant-numeric: tabular-nums; }
.detailEmpty {
  margin: auto;
  color: var(--color-font-label);
  font-size: 12px;
}
.recommendProviders {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin: 6px 0 16px;
  > span { margin-right: 5px; color: var(--color-font-label); font-size: 11px; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 7px 13px;
    border-radius: 18px;
    border: 1px solid var(--color-primary-alpha-900);
    background: var(--color-primary-background);
    color: var(--color-font-label);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background-color @transition-fast, border-color @transition-fast;
    &:hover { background: var(--color-primary-background-hover); }
    &.providerSelected { background: var(--color-primary-alpha-900); border-color: var(--color-primary-alpha-500); color: var(--color-font); }
  }
}
.libraryImportButton {
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: 12px;
  padding: 0 0 12px;
  cursor: pointer;
}
@keyframes q-search-skeleton {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

.skeletonBlock() {
  display: block;
  border-radius: 6px;
  background: linear-gradient(100deg, var(--q-surface-soft) 20%, var(--q-surface-strong) 45%, var(--q-surface-soft) 70%);
  background-size: 220% 100%;
  animation: q-search-skeleton 1.4s ease-in-out infinite;
}

.trackPreviewSkeleton {
  li { align-items: center; height: 15px; }
  i {
    .skeletonBlock();
    height: 9px;
    &:first-child { width: 34%; }
    &:last-child { width: 22%; opacity: .7; }
  }
  li:nth-child(2) i:first-child { width: 42%; }
  li:nth-child(3) i:first-child { width: 28%; }
}

.playlistSkeleton > div {
  min-width: 0;

  i {
    .skeletonBlock();
    aspect-ratio: 1;
    border-radius: 10px;
  }
  b {
    .skeletonBlock();
    height: 10px;
    margin-top: 10px;
    width: 76%;
    & + b { width: 44%; height: 8px; margin-top: 7px; opacity: .7; }
  }
}

.detailTracksSkeleton {
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 7px 8px 12px;
  list-style: none;
  overflow: hidden;

  li {
    display: grid;
    grid-template-columns: 42px minmax(210px, 1.55fr) minmax(130px, .82fr) minmax(160px, 1fr) 58px 42px;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 0 8px;
  }
  i {
    .skeletonBlock();
    height: 10px;
    &:nth-child(1) { width: 20px; }
    &:nth-child(2) { width: 62%; height: 12px; }
    &:nth-child(3) { width: 48%; }
    &:nth-child(4) { width: 54%; }
    &:nth-child(5) { width: 34px; }
  }
  // 越往下越淡，暗示列表仍在延伸
  li:nth-child(n + 5) { opacity: .7; }
  li:nth-child(n + 7) { opacity: .4; }
}

.fadeImg {
  opacity: 0;
  transition: opacity .38s ease;

  &:global(.q-cover-loaded) { opacity: 1; }
}

.panelEnterActive {
  transition: opacity .24s ease, transform .34s cubic-bezier(.22, 1, .36, 1);
}
.panelLeaveActive {
  transition: opacity .14s ease;
}
.panelFromRight {
  opacity: 0;
  transform: translateX(18px);
}
.panelFromLeft {
  opacity: 0;
  transform: translateX(-18px);
}
.panelFade {
  opacity: 0;
}

@media (max-width: 900px) {
  .noitem {
    padding-left: 28px;
    padding-right: 28px;
  }
  .detailHeader { flex-wrap: wrap; }
  .detailActions { width: 100%; padding-left: 54px; }
  .detailTableHeader, .detailTracks li {
    grid-template-columns: 38px minmax(160px, 1.4fr) minmax(110px, .8fr) 54px 40px;

    > :nth-child(4) { display: none; }
  }
  .detailTracksSkeleton li {
    grid-template-columns: 38px minmax(160px, 1.4fr) minmax(110px, .8fr) 54px 40px;

    > :nth-child(4) { display: none; }
  }
  .playlistRail { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .discoveryGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .playlistSkeleton > div:nth-child(n + 4) { display: none; }
}

@media (max-height: 680px) {
  .noitem {
    align-items: flex-start;
    padding-top: 24px;
  }
  .welcomeBar {
    min-height: 58px;
  }
  .dailyCard {
    min-height: 208px;
    padding: 18px;
  }
  .dailyCover { width: 168px; height: 168px; }
  .trackPreview li:nth-child(n + 3) { display: none; }
}
</style>
