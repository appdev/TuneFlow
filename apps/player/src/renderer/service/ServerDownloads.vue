<template>
  <section class="tf-downloads" :class="$style.page">
    <header class="tf-workspace-heading"><div><h1>下载</h1><p>音乐下载完成后，在音乐库继续收听。</p></div><div class="tf-workspace-actions"><button :disabled="busy" @click="load">刷新任务</button><router-link to="/setting?name=SettingDownload">下载设置</router-link></div></header>
    <div :class="$style.table">
      <header :class="$style.toolbar">
        <h2>下载任务</h2>
        <span :class="$style.count">共 {{ tasks.length }} 个任务</span>
      </header>
      <p v-if="error" role="alert">{{ error }}</p>
      <div :class="[$style.row, $style.head, 'scroll']" aria-hidden="true">
        <span :class="$style.index">#</span><span>歌曲名</span><span :class="$style.artist">艺术家</span><span>下载状态</span><span :class="$style.actionHeading">操作</span>
      </div>
      <p v-if="!tasks.length" :class="$style.empty">{{ busy ? '正在加载任务…' : error ? '暂时无法加载任务，请刷新重试' : '暂无下载任务' }}</p>
      <base-virtualized-list v-else v-slot="{ item: task, index }: { item: DownloadDto, index: number }" :class="$style.tasks" :list="tasks" key-name="id" :item-height="taskRowHeight" container-class="scroll">
        <article :class="[$style.row, $style.task, { [$style.running]: task.status === 'running' }]" :aria-label="`${task.musicInfo.name}，${labels[task.status]}`">
          <span :class="$style.index">{{ index + 1 }}</span>
          <div :class="$style.song">
            <img v-if="task.musicInfo.meta?.picUrl" :class="$style.cover" :src="task.musicInfo.meta.picUrl" alt="" loading="lazy" @error="$event.target.style.visibility = 'hidden'">
            <div :class="$style.songCopy"><div :class="$style.title" :title="task.musicInfo.name">
              <strong>{{ task.musicInfo.name || '未知歌曲' }}</strong>
            </div>
            <span :class="$style.mobileArtist">{{ task.musicInfo.singer || '未知艺术家' }}</span></div>
          </div>
          <span :class="[$style.artist, $style.ellipsis]" :title="task.musicInfo.singer">{{ task.musicInfo.singer || '—' }}</span>
          <div :class="$style.status" :data-status="task.status">
            <div :class="$style.statusLabel"><span>{{ labels[task.status] }}</span><span :class="$style.quality">{{ task.quality }}</span></div>
            <span v-if="task.status === 'error' && task.error" :class="[$style.detail, $style.ellipsis]" :title="task.error">{{ task.error }}</span>
            <template v-else-if="task.status !== 'completed'">
              <div :class="$style.progress" role="progressbar" aria-label="下载进度" :aria-valuenow="progress(task.progress)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress(task.progress)}%` }" /></div>
              <span :class="$style.percentage">{{ progress(task.progress) }}%</span>
            </template>
          </div>
          <div :class="$style.actions">
            <button v-if="['running', 'waiting'].includes(task.status)" :disabled="busy" @click="act(task.id, 'pause')">暂停</button>
            <button v-else-if="task.status !== 'completed'" :disabled="busy" @click="act(task.id, 'resume')">{{ task.status === 'error' ? '重试' : '继续' }}</button>
            <router-link v-else :to="`/list?id=${LIBRARY_ID}`">音乐库</router-link>
            <button :disabled="busy" :aria-label="`移除任务记录：${task.musicInfo.name}`" title="移除任务记录，保留音乐文件" @click="remove(task.id)">移除</button>
          </div>
        </article>
      </base-virtualized-list>
      <p :class="$style.hint">移除任务记录会保留已下载的文件。</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { ref, shallowRef, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import useTrackRowHeight from '@renderer/utils/compositions/useTrackRowHeight'
import { getWorkspace, LIBRARY_ID } from './session'
import { type DownloadDto } from './client'
import { dialog } from '@renderer/plugins/Dialog'

defineOptions({ name: 'ServerDownloads' })

const tasks = shallowRef<DownloadDto[]>([])
const taskRowHeight = useTrackRowHeight()
const progress = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
const busy = ref(false)
const error = ref('')
const labels = { waiting: '排队中', running: '下载中', paused: '已暂停', error: '失败', completed: '已完成' }
let active = false
let visibilityRevision = 0
let loadRevision = 0
let loading: AbortController | undefined
let timer: ReturnType<typeof setTimeout>
const load = async() => {
  if (busy.value || !active) return
  const revision = ++loadRevision
  const request = loading = new AbortController()
  busy.value = true
  try {
    const value = await getWorkspace().client.downloads(request.signal)
    if (active && revision === loadRevision) { tasks.value = value; error.value = '' }
  } catch (e) {
    if (active && revision === loadRevision && !request.signal.aborted) error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (revision === loadRevision) { busy.value = false; loading = undefined }
  }
}
const act = async(id: string, action: 'pause' | 'resume') => {
  if (busy.value) return
  busy.value = true
  try { await getWorkspace().client.downloadAction(id, action) } catch (e) { error.value = e instanceof Error ? e.message : '操作失败' } finally { busy.value = false }
  await load()
}
const remove = async(id: string) => {
  if (!await dialog.confirm({ message: '移除下载记录？已完成的音乐文件会保留。' })) return
  if (busy.value) return
  busy.value = true
  try { await getWorkspace().client.deleteDownload(id) } catch (e) { error.value = e instanceof Error ? e.message : '操作失败' } finally { busy.value = false }
  await load()
}
const start = () => {
  if (active) return
  active = true
  const revision = ++visibilityRevision
  const poll = () => {
    void load().finally(() => {
      if (active && revision === visibilityRevision) timer = setTimeout(poll, 2500)
    })
  }
  poll()
}
const stop = () => {
  active = false
  visibilityRevision++
  clearTimeout(timer)
  if (loading) {
    loadRevision++
    loading.abort()
    loading = undefined
    busy.value = false
  }
}
onMounted(start)
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style module lang="less">
@import '@renderer/assets/styles/layout.less';
.page {
  display: flex;
  flex-direction: column;
  padding: 16px 22px calc(@height-player + 14px);
  overflow: hidden;
  box-sizing: border-box;
  line-height: 1.5;
  color: var(--color-font);
  container-type: inline-size;
  > * { flex: none; }
  button, a {
    color: inherit;
    border: 0;
    border-radius: 7px;
    padding: .4em .65em;
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
    &:hover { color: var(--color-primary); background: var(--color-primary-alpha-900); }
    &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    &:disabled { opacity: .45; cursor: default; }
  }
}
.toolbar {
  display: flex; align-items: center; gap: .7em; flex-wrap: wrap; padding: 10px 14px;
  h2 { display: flex; align-items: center; gap: .65em; margin: 0; font-size: 1em; font-weight: 600; }
  svg { width: 1.15em; height: 1.15em; fill: currentColor; opacity: .65; }
}
.count { margin-left: auto; color: var(--q-list-muted); font-size: var(--q-list-detail-size); }
.hint { margin: 0; padding: 0 18px 10px; opacity: .6; font-size: .75em; }
.table { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid rgb(from var(--color-font) r g b / .04); border-radius: 18px; background: rgb(from var(--color-content-background) r g b / .55); box-shadow: 0 12px 32px rgba(34, 45, 48, .04); overflow: hidden; > * { flex-shrink: 0; } }
.row { font-size: var(--q-list-title-size); display: grid; grid-template-columns: 2.5em minmax(0, 2fr) minmax(0, 1fr) minmax(7.5em, .9fr) 8.5em; align-items: center; column-gap: .8em; padding: 0 14px; }
.head { flex: none; min-height: 2.8em; padding: 0 15px; border-top: 1px solid rgb(from var(--color-font) r g b / .05); border-bottom: 1px solid rgb(from var(--color-font) r g b / .05); color: var(--q-list-muted); > span { font-size: var(--q-list-detail-size); } }
.tasks { flex: 1; min-height: 0; scrollbar-gutter: stable; }
.head { scrollbar-gutter: stable; overflow-y: auto; }
.task { height: calc(100% - 4px); margin: 2px 6px; padding: 0 8px; box-sizing: border-box; border: 1px solid transparent; border-bottom-color: rgb(from var(--color-font) r g b / .05); border-radius: 12px; &:hover { background: var(--color-primary-alpha-900); } }
.running { background: var(--color-primary-alpha-900); border-color: var(--color-primary-alpha-800); }
.index { text-align: center; font-size: var(--q-list-detail-size); color: var(--q-list-muted); font-variant-numeric: tabular-nums; }
.song, .status { min-width: 0; }
.title { font-size: var(--q-list-title-size); color: var(--q-list-text); display: flex; align-items: center; strong { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobileArtist { display: none; }
.artist { font-size: var(--q-list-detail-size); color: var(--q-list-muted); }
.status { position: relative; font-size: var(--q-list-detail-size); &[data-status='completed'] { color: var(--color-primary); } &[data-status='error'] .detail { color: var(--color-font); } }
.statusLabel { display: flex; gap: .5em; justify-content: space-between; }
.quality { color: var(--q-list-muted); text-transform: uppercase; font-size: var(--q-list-detail-size); }
.detail { display: block; color: var(--q-list-muted); font-size: var(--q-list-detail-size); }
.progress { height: 3px; margin-top: 7px; margin-right: 3em; background: var(--color-primary-alpha-800); border-radius: 3px; overflow: hidden; > span { display: block; height: 100%; background: var(--color-primary); } }
.percentage { position: absolute; right: 0; bottom: -.3em; font-size: var(--q-list-detail-size); color: var(--q-list-muted); font-variant-numeric: tabular-nums; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: .25em; font-size: .85em; > :first-child { color: var(--color-primary); } > :last-child { opacity: .65; } }
.actionHeading { text-align: right; padding-right: .65em; }
.empty { margin: auto; padding: 40px 12px; opacity: .65; text-align: center; }
@container (max-width: 850px) {
  .row { grid-template-columns: 2em minmax(0, 2fr) minmax(0, 1fr) minmax(7.5em, 1fr) 8.5em; }
}
@container (max-width: 680px) {
  .row { grid-template-columns: minmax(0, 1fr) 7.5em 7.5em; column-gap: .5em; }
  .index, .artist { display: none; }
  .mobileArtist { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--q-list-muted); font-size: var(--q-list-detail-size); }
  .hint { font-size: .8em; }
}
@container (max-width: 440px) {
  .row { grid-template-columns: minmax(0, 1fr) 6em 3.6em; }
  .actions { flex-direction: column; gap: 0; button, a { padding: 0 .4em; } }
  .quality { display: none; }
}
.page { padding: 32px 0 0; gap: 32px; color: var(--tf-ink); }
.table { border: 0; border-radius: 0; background: none; box-shadow: none; }
.toolbar { padding: 0 0 20px; h2 { font-size: 20px; } }
.count { color: var(--tf-muted); font-size: 14px; }
.hint { padding: 16px 0; opacity: 1; color: var(--tf-muted); font-size: 14px; }
.head { padding-inline: 12px; border-top: 0; border-bottom: 1px solid var(--tf-rule); min-height: 44px; color: var(--tf-muted); }
.task { margin: 0; padding-inline: 12px; height: 100%; border: 0; border-bottom: 1px solid var(--tf-rule); border-radius: 0; }
.running { background: none; }
.song { display: flex; align-items: center; gap: 12px; }
.songCopy { min-width: 0; }
.cover { width: 44px; height: 44px; object-fit: cover; flex: none; border-radius: 6px; }
.mobileArtist { display: block; font-size: 13px; color: var(--tf-muted); margin-top: 6px; }
.row { grid-template-columns: 44px minmax(0, 2fr) minmax(0, 1fr) minmax(7.5em, 1.2fr) 9em; }
.title strong { font-weight: 500; color: var(--tf-ink); }
.actions { font-size: 14px; }
.quality, .detail, .percentage { color: var(--tf-muted); }
.status[data-status='running'], .status[data-status='completed'] { color: var(--tf-accent); }
.statusLabel { font-size: 14px; }
.empty { opacity: 1; color: var(--tf-muted); }
.page :global(.tf-workspace-actions) { button, a { min-height: 44px; box-sizing: border-box; padding: 8px 16px; border-radius: 10px; background: var(--tf-surface); display: inline-flex; align-items: center; } }
@container (max-width: 680px) { .row { grid-template-columns: minmax(0, 1fr) 7.5em 7.5em; } .cover { display: none; } }
@container (max-width: 440px) { .row { grid-template-columns: minmax(0, 1fr) 6em 3.6em; } }
@media (max-width: 760px) { .page { padding-top: 24px; gap: 24px; } }
</style>
