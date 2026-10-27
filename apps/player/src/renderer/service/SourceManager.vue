<template>
  <div :class="$style.manager" :aria-busy="busy">
    <header :class="$style.heading">
      <h2>音源与自动切换</h2>
      <p>按优先级依次尝试已启用的音源，顺序会在所有设备间同步。</p>
    </header>
    <section :class="$style.card" aria-label="导入音源">
      <h3>导入音源</h3>
      <form :class="$style.urlImport" @submit.prevent="!busy && sourceUrl.trim() && $emit('import-url')">
        <label for="source-import-url">脚本地址</label>
        <input id="source-import-url" type="url" :value="sourceUrl" :disabled="busy" placeholder="https://example.com/source.js" @input="$emit('update:sourceUrl', ($event.target as HTMLInputElement).value)">
        <button :class="$style.primary" :disabled="busy || !sourceUrl.trim()" type="submit">从地址导入</button>
      </form>
      <div :class="$style.fileImport">
        <input ref="fileInput" type="file" accept=".js,.txt" :class="$style.fileInput" tabindex="-1" aria-label="选择音源脚本文件" :disabled="busy" @change="$emit('import-file', $event)">
        <button :disabled="busy" type="button" @click="fileInput?.click()">选择脚本文件</button>
        <span>支持 .js、.txt 文件，最大 1 MiB。导入后需手动启用。</span>
      </div>
    </section>
    <section :class="$style.card" aria-label="已导入音源">
      <header :class="$style.listHeader"><h3>已导入音源 <small>{{ sources.length }}</small></h3><button type="button" :disabled="busy" @click="$emit('refresh')">刷新</button></header>
      <p v-if="!sources.length" :class="$style.empty">{{ busy ? '正在加载音源…' : '暂无音源，可从地址或脚本文件导入。' }}</p>
      <template v-for="group in groups" :key="group.enabled ? 'enabled' : 'disabled'">
        <template v-if="group.items.length">
          <div :class="$style.groupHeading"><h4>{{ group.enabled ? '已启用 · 播放优先级' : '未启用' }}</h4><span>{{ group.enabled ? '拖动排序，或使用上移 / 下移；调整后自动保存' : '启用后加入优先级末尾' }}</span></div>
          <article v-for="(source, index) in group.items" :key="source.id" :class="[$style.source, { [$style.dragging]: dragging === source.id, [$style.dropTarget]: dragTarget === source.id }]" :data-source-id="source.id" @dragover.prevent="group.enabled && !busy && dragging && (dragTarget = source.id)" @drop.prevent="drop(source.id)" @dragend="clearDrag">
            <button v-if="group.enabled" type="button" :class="$style.handle" :disabled="busy" :draggable="!busy" :aria-label="`调整顺序：${source.name}`" title="拖动排序；聚焦后按上下方向键调整" @dragstart="startDrag($event, source.id)" @keydown.up.stop.prevent="move(source.id, index - 1)" @keydown.down.stop.prevent="move(source.id, index + 1)" @keyup.up.stop @keyup.down.stop>⠿</button>
            <span :class="$style.position">{{ group.enabled ? index + 1 : '—' }}</span>
            <div :class="$style.identity"><strong :title="source.name">{{ source.name }}</strong><span>版本 {{ source.version || '未知' }}</span></div>
            <span :class="[$style.badge, { [$style.enabled]: group.enabled }]">{{ group.enabled ? '已启用' : '未启用' }}</span>
            <div :class="$style.actions">
              <template v-if="group.enabled">
                <button type="button" :disabled="busy || index === 0" :aria-label="`上移：${source.name}`" @click="move(source.id, index - 1)">上移</button>
                <button type="button" :disabled="busy || index === group.items.length - 1" :aria-label="`下移：${source.name}`" @click="move(source.id, index + 1)">下移</button>
                <button type="button" :disabled="busy || index === 0" :aria-label="`置顶：${source.name}`" @click="move(source.id, 0)">置顶</button>
              </template>
              <button type="button" :disabled="busy" :aria-label="`${group.enabled ? '停用' : '启用'}：${source.name}`" @click="$emit('enable', source.id, !source.enabled)">{{ group.enabled ? '停用' : '启用' }}</button>
              <button type="button" :class="$style.remove" :disabled="busy" :aria-label="`移除：${source.name}`" @click="$emit('remove', source.id)">移除</button>
            </div>
          </article>
        </template>
      </template>
      <p v-if="sources.length && !chain.enabled.length" :class="$style.empty">尚未启用音源，启用后才会用于播放与自动切换。</p>
    </section>
    <p :class="$style.safety">可恢复的解析失败会继续尝试其他平台；安全拦截和取消操作不会被重试绕过。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SourceDto } from './client'
import { splitSourceChain } from './sourceChain'
const props = defineProps<{ sources: SourceDto[], busy: boolean, sourceUrl: string }>()
const emit = defineEmits<{
  'update:sourceUrl': [value: string]
  'import-url': []
  'import-file': [event: Event]
  refresh: []
  enable: [id: string, enabled: boolean]
  move: [id: string, position: number]
  remove: [id: string]
}>()
const fileInput = ref<HTMLInputElement>()
const chain = computed(() => splitSourceChain<SourceDto>(props.sources))
const groups = computed(() => [{ enabled: true, items: chain.value.enabled }, { enabled: false, items: chain.value.disabled }])
const dragging = ref('')
const dragTarget = ref('')
const clearDrag = () => { dragging.value = ''; dragTarget.value = '' }
const move = (id: string, position: number) => {
  if (!props.busy && position >= 0 && position < chain.value.enabled.length) emit('move', id, position)
}
const startDrag = (event: DragEvent, id: string) => {
  if (props.busy) { event.preventDefault(); return }
  dragging.value = id
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
}
const drop = (id: string) => {
  const position = chain.value.enabled.findIndex(source => source.id === id)
  if (dragging.value && dragging.value !== id) move(dragging.value, position)
  clearDrag()
}
</script>

<style module lang="less">
.manager { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; container-type: inline-size;
  h2, h3, h4, p { margin: 0; }
  h2 { font-size: 20px; font-weight: 600; }
  h3 { font-size: 15px; font-weight: 600; }
  h4 { font-size: 13px; font-weight: 500; }
  button { min-height: 34px; padding: 5px 10px; margin: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
  button:disabled { opacity: .35; cursor: default; }
  button:hover:not(:disabled) { background: var(--color-primary-alpha-900); color: var(--color-primary); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}
.heading p, .safety { color: var(--color-font-label); font-size: 13px; }
.heading p { margin-top: 6px; }
.card { padding: 18px; border-radius: 16px; border: 1px solid rgb(from var(--color-font) r g b / .06); background: rgb(from var(--color-content-background) r g b / .55); }
.urlImport { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; margin-top: 14px;
  label { margin: 0; font-size: 13px; }
  input { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid rgb(from var(--color-font) r g b / .15); border-radius: 9px; padding: 9px 12px; font-size: 14px; color: inherit; background: transparent; }
  .primary { color: var(--color-primary); background: var(--color-primary-alpha-900); }
}
.fileImport { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px;
  button { border-color: rgb(from var(--color-font) r g b / .12); }
  span { font-size: 12px; color: var(--color-font-label); }
}
.fileInput { display: none; }
.listHeader { display: flex; align-items: center; justify-content: space-between; small { margin-left: 6px; color: var(--color-font-label); font-weight: 400; } }
.groupHeading { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 14px 0 4px; span { color: var(--color-font-label); font-size: 12px; } }
.manager .source { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid rgb(from var(--color-font) r g b / .06); }
.handle { cursor: grab; -webkit-user-drag: element; color: var(--color-font-label); font-size: 20px !important; padding: 0 4px !important; }
.position { flex: 0 0 20px; text-align: center; font-variant-numeric: tabular-nums; color: var(--color-font-label); }
.identity { min-width: 0; flex: 1; display: flex; flex-direction: column; strong { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } span { color: var(--color-font-label); font-size: 12px; } }
.badge { padding: 2px 7px; font-size: 11px; border-radius: 6px; color: var(--color-font-label); background: rgb(from var(--color-font) r g b / .04); }
.enabled { color: var(--color-primary); background: var(--color-primary-alpha-900); }
.actions { display: flex; gap: 2px; .remove { color: var(--color-font-label); } }
.dragging { opacity: .45; }
.manager .dropTarget { border-bottom: 2px solid var(--color-primary); }
.manager .empty { padding: 20px 0; font-size: 13px; color: var(--color-font-label); text-align: center; }
@container (max-width: 700px) { .manager .source { flex-wrap: wrap; } .identity { flex-basis: calc(100% - 170px); } .actions { margin-left: auto; } }
@container (max-width: 440px) { .urlImport { grid-template-columns: minmax(0, 1fr) auto; label { grid-column: 1 / -1; } } .card { padding: 12px; } .manager .source { gap: 6px; } .badge { display: none; } }
</style>
