<template>
  <section :class="$style.panel">
    <template v-if="section === 'connection'">
      <h2>连接设置</h2>
      <p>音乐库、歌单、收藏、播放记录与下载在各设备间保持一致。更改连接地址不会删除数据。</p>
      <label>连接地址 <input v-model="address" aria-label="连接地址" placeholder="http://192.168.0.70:3124"></label>
      <button :disabled="busy" @click="run(() => connectService(address, reload))">连接并使用</button>
      <button :disabled="busy" @click="run(() => checkService(true))">重新连接 / 刷新</button>
      <p>{{ status.connected ? '已连接' : '连接不可用' }} · {{ status.endpoint }}</p>
      <h3>功能归属</h3>
      <p>在这里管理连接、音源和下载；外观、播放与歌词可按自己的习惯调整。</p>
    </template>
    <template v-else-if="section === 'sources'">
      <h2>音源与自动切换</h2>
      <p>按启用顺序尝试音源；可恢复的解析失败继续尝试其他平台。安全拦截和取消操作不会被重试绕过。</p>
      <label>脚本地址 <input v-model="sourceUrl" aria-label="音源脚本地址" placeholder="https://…/source.js"></label>
      <button :disabled="busy || !sourceUrl.trim()" @click="run(async() => { await client.importSource(sourceUrl); await load() })">从地址导入</button>
      <label>导入脚本文件 <input type="file" accept=".js,.txt" :disabled="busy" @change="importFile"></label>
      <button :disabled="busy" @click="run(load)">刷新音源</button>
      <p v-if="!sources.length">暂无音源，请导入后启用。</p>
      <article v-for="source in orderedSources" :key="source.id">
        <strong>{{ source.name }}</strong> {{ source.version }} · {{ source.enabled ? `已启用 · 第 ${(source.priority ?? 0) + 1} 位` : '未启用' }}
        <button :disabled="busy" @click="run(() => enable(source.id, !source.enabled))">{{ source.enabled ? '停用' : '启用' }}</button>
        <button v-if="source.enabled" :disabled="busy || source.priority === 0" @click="run(() => moveFirst(source.id))">移至首位</button>
        <button :disabled="busy" @click="removeSource(source.id)">移除</button>
      </article>
    </template>
    <template v-else-if="section === 'downloads'">
      <h2>下载设置</h2>
      <p>下载完成后可在“我的音乐 → 音乐库”中播放。</p>
      <p>开启边听边存后，在线播放的歌曲会按最高可用音质自动保存，已有音频会跳过。此功能独立于手动下载开关。</p>
      <button :disabled="busy" @click="run(load)">刷新设置</button>
      <label v-for="key in settingKeys" :key="key" :class="$style.setting">
        {{ downloadSettingLabels[key] }}
        <input v-if="typeof settings[key] === 'boolean'" type="checkbox" :checked="settings[key]" :disabled="busy" @change="patch(key, $event.target.checked)">
        <template v-else-if="key === 'download.savePath'">{{ settings[key] }}</template>
        <input v-else :type="typeof settings[key] === 'number' ? 'number' : 'text'" :value="settings[key]" :disabled="busy" @change="patch(key, typeof settings[key] === 'number' ? Number($event.target.value) : $event.target.value)">
      </label>
    </template>
    <template v-else>
      <h2>兼容功能说明</h2>
      <p>在“音乐平台账号”中登录，即可浏览账号歌单与个人推荐。导入歌单会保留已有内容，旧版同步与备份不会自动覆盖数据。</p>
      <p>已有数据保持不变，音乐库、收藏、歌单与播放记录无需额外开启同步。</p>
    </template>
    <p v-if="error || status.error" role="alert">{{ error || status.error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { type SourceDto } from './client'
import { downloadSettingLabels } from './workspace'
import { getWorkspace, serviceStatus, subscribeService, connectService, checkService } from './session'
import { dialog } from '@renderer/plugins/Dialog'
import { rendererSend } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

const props = withDefaults(defineProps<{ section?: string }>(), { section: 'connection' })
const client = getWorkspace().client
const reload = () => { rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.restart_window) }
const address = ref(client.endpoint)
const sourceUrl = ref('')
const busy = ref(false)
const error = ref('')
const status = ref({ ...serviceStatus })
const sources = ref<SourceDto[]>([])
const settings = ref<Record<string, any>>({})
const orderedSources = computed(() => [...sources.value].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999)))
const settingKeys = computed(() => Object.keys(downloadSettingLabels).filter(key => key in settings.value))
const unsubscribe = subscribeService(() => { status.value = { ...serviceStatus } })
onBeforeUnmount(unsubscribe)
const load = async() => {
  if (props.section === 'sources') sources.value = await client.sources()
  if (props.section === 'downloads') settings.value = await client.settings()
}
const run = async(action: () => Promise<unknown>) => {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : '操作失败' } finally { busy.value = false }
}
const enabled = () => orderedSources.value.filter(item => item.enabled).map(item => item.id)
const enable = async(id: string, value: boolean) => { sources.value = await client.enableSources(value ? [...enabled(), id] : enabled().filter(item => item !== id)) }
const moveFirst = async(id: string) => { sources.value = await client.enableSources([id, ...enabled().filter(item => item !== id)]) }
const removeSource = async(id: string) => {
  if (!await dialog.confirm({ message: '移除此音源？移除后将使用更新后的音源顺序。' })) return
  await run(async() => { await client.request(`/api/v1/sources/${encodeURIComponent(id)}`, 'DELETE'); await load() })
}
const importFile = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  void run(async() => {
    if (file.size > 1024 * 1024) throw new Error('脚本文件超过 1 MiB 限制')
    await client.request('/api/v1/sources', 'POST', { script: await file.text() }); await load()
    input.value = ''
  })
}
const patch = (key: string, value: unknown) => { void run(async() => { settings.value = await client.patchSettings({ [key]: value }) }) }
onMounted(() => { void run(load) })
</script>

<style module lang="less">
.panel { padding: 14px 20px; line-height: 1.7; color: var(--color-font); h2 { font-size: 18px; } p { margin: 10px 0; } input { color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; padding: 7px; max-width: 100%; } button { color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; padding: 7px 12px; margin: 5px; cursor: pointer; } button:disabled { opacity: .5; } label { display: block; margin: 12px 0; } article { border-bottom: 1px solid var(--color-primary-light-400); padding: 10px 0; } }
.setting { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; }
</style>
