<template>
  <section :class="$style.page">
    <h2>下载</h2>
    <p>任务在服务器执行。完成后可在“我的音乐 → 音乐库”播放；移除任务记录会保留已下载的文件。</p>
    <div>
      <button :disabled="busy" @click="load">刷新任务</button>
      <router-link to="/setting?name=SettingDownload">下载设置</router-link>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!tasks.length && !error">{{ busy ? '正在加载任务…' : '暂无下载任务' }}</p>
    <p v-if="tasks.length">共 {{ tasks.length }} 个任务</p>
    <base-virtualized-list v-if="tasks.length" v-slot="{ item: task }: { item: DownloadDto }" :class="$style.tasks" :list="tasks" key-name="id" :item-height="taskRowHeight" container-class="scroll">
      <article>
        <div :class="$style.track" :title="`${task.musicInfo.name} · ${task.musicInfo.singer}`"><strong>{{ task.musicInfo.name }}</strong> · {{ task.musicInfo.singer }}</div>
        <p>{{ labels[task.status] }} · {{ Math.round(task.progress) }}% · {{ task.quality }}</p>
        <p v-if="task.error" :class="$style.taskError" :title="task.error">{{ task.error }}</p>
        <div>
          <button v-if="['running', 'waiting'].includes(task.status)" :disabled="busy" @click="act(task.id, 'pause')">暂停</button>
          <button v-else-if="task.status !== 'completed'" :disabled="busy" @click="act(task.id, 'resume')">继续 / 重试</button>
          <router-link v-else :to="`/list?id=${LIBRARY_ID}`">打开音乐库</router-link>
          <button :disabled="busy" @click="remove(task.id)">移除任务记录</button>
        </div>
      </article>
    </base-virtualized-list>
  </section>
</template>
<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { appSetting } from '@renderer/store/setting'
import { isFullscreen } from '@renderer/store'
import { getFontSizeWithScreen } from '@renderer/utils'
import { getWorkspace, LIBRARY_ID } from './session'
import { type DownloadDto } from './client'
import { dialog } from '@renderer/plugins/Dialog'

defineOptions({ name: 'ServerDownloads' })

const tasks = shallowRef<DownloadDto[]>([])
const taskRowHeight = computed(() => Math.max(132, Math.ceil((isFullscreen.value ? getFontSizeWithScreen() : appSetting['common.fontSize']) * 12)))
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
  if (!await dialog.confirm({ message: '移除服务器任务记录？已完成的音乐文件会保留。' })) return
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
.page { display: flex; flex-direction: column; padding: 20px 20px calc(@height-player + 20px); overflow: hidden; box-sizing: border-box; line-height: 1.7; color: var(--color-font); > * { flex: none; } h2 { font-size: 20px; } p { margin: 8px 0; } button, a { color: inherit; border: 1px solid currentColor; border-radius: 5px; padding: 6px 10px; margin: 5px; background: transparent; cursor: pointer; } article { height: 100%; box-sizing: border-box; padding: 10px 0; border-bottom: 1px solid var(--color-primary-light-400); } }
.tasks { flex: 1; min-height: 0; }
.track, .taskError { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
