<template>
  <material-modal :show="visible" :bg-close="!busy" teleport="#view" @close="close">
    <main class="scroll" :class="$style.main" :aria-busy="busy">
      <h2>{{ $t('local_import_title') }}</h2>
      <p>{{ $t('local_import_description') }}</p>
      <div :class="$style.actions">
        <base-btn :disabled="busy" @click="selectFiles">{{ $t('local_import_files') }}</base-btn>
        <base-btn :disabled="busy" @click="selectFolder">{{ $t('local_import_folder') }}</base-btn>
      </div>
      <div :class="$style.options">
        <base-checkbox id="local-import-recursive" v-model="recursive" :disabled="busy" :label="$t('local_import_recursive')" />
        <base-checkbox id="local-import-group" v-model="byFolder" :disabled="busy" :label="$t('local_import_by_folder')" />
      </div>
      <p>{{ $t('local_import_target', { name: targetName }) }}</p>
      <p :class="$style.hint">{{ $t('local_import_hint') }}</p>
      <p v-if="message" role="status" aria-live="polite" :class="$style.status">{{ message }}</p>
      <base-btn v-if="firstListId && !busy" @click="openList">{{ $t('local_import_open') }}</base-btn>
    </main>
  </material-modal>
</template>

<script setup lang="ts">
import { computed, ref } from '@common/utils/vueTools'
import { userLists } from '@renderer/store/list/state'
import { showSelectDialog } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { localAudioExtensions } from '@common/utils/localMusicFiles'
import { importLocalMusicFiles } from '../actions'

defineProps<{ visible: boolean }>()
const emit = defineEmits(['update:visible', 'open-list'])
const t = useI18n()
const busy = ref(false)
const recursive = ref(true)
const byFolder = ref(true)
const message = ref('')
const firstListId = ref('')
const targetName = computed(() => userLists.find(item => item.id == 'local_music')?.name ?? t('local_import_title'))
const close = () => { if (!busy.value) emit('update:visible', false) }
const openList = () => { emit('open-list', firstListId.value); close() }
const select = async(folder: boolean) => {
  if (busy.value) return
  busy.value = true
  message.value = ''
  firstListId.value = ''
  try {
    const result = await showSelectDialog({
      title: t(folder ? 'local_import_folder' : 'local_import_files'),
      properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      ...(folder ? {} : { filters: [{ name: 'Audio', extensions: localAudioExtensions }] }),
    })
    if (result.canceled || !result.filePaths.length) return
    message.value = t('local_import_scanning')
    const scanned = folder
      ? await window.lx.worker.main.scanLocalMusicFolders(result.filePaths, recursive.value)
      : { files: result.filePaths, unreadableFolders: 0 }
    if (!scanned.files.length) {
      message.value = t('local_import_empty')
    } else {
      const imported = await importLocalMusicFiles(scanned.files, {
        byFolder: folder && byFolder.value,
        onProgress: (current, total) => { message.value = t('local_import_progress', { current, total }) },
      })
      message.value = t('local_import_result', { added: imported.added, duplicates: imported.duplicates, skipped: imported.skipped })
      firstListId.value = imported.firstListId ?? ''
    }
    if (scanned.unreadableFolders) message.value += ` ${t('local_import_unreadable', { count: scanned.unreadableFolders })}`
  } catch {
    message.value = t('local_import_failed')
  } finally { busy.value = false }
}
const selectFiles = async() => select(false)
const selectFolder = async() => select(true)
</script>

<style lang="less" module>
.main {
  min-height: 0;
  overflow-y: auto;
  flex: 1;
  width: min(420px, calc(100vw - 90px));
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-font);
  > * { flex-shrink: 0; }
  h2 { font-size: 18px; font-weight: 600; }
  p { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
}
.actions { display: flex; gap: 12px; > * { flex: 1; } }
.options { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--q-outline); border-radius: 12px; }
.hint { color: var(--color-font-label); }
.status { padding: 12px; background: var(--q-surface-soft); border-radius: 10px; }
</style>
