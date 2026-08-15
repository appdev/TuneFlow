<template lang="pug">
material-modal(:show="modelValue" bg-close teleport="#view" @close="handleClose")
  main.scroll(:class="$style.main")
    h2 {{ $t('user_api__title') }}
    div.scroll(v-if="isWebRuntime" :class="$style.content")
      section(:class="$style.sourceGroup")
        h3(:class="$style.groupTitle") {{ $t('user_api__enabled_sources') }}
        ul(ref="enabledListElement" data-testid="enabled-source-list")
          li(v-for="(api, index) in enabledSources" :key="api.id" :class="[$style.listItem, $style.enabledItem, {[$style.active]: index === 0}]")
            span(:data-testid="`source-drag-${api.id}`" :class="$style.dragHandle" :title="$t('user_api__drag_to_reorder')" aria-hidden="true") ⋮⋮
            span(:class="$style.priority") {{ $t('user_api__priority', { priority: index + 1 }) }}
            div(:class="$style.listLeft")
              h3
                | {{ api.name }}
                span(v-if="api.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
                span(v-if="api.author") {{ api.author }}
              p {{ api.description }}
              div
                base-checkbox(:id="`user_api_alert_${api.id}`" v-model="api.allowShowUpdateAlert" :class="$style.checkbox" :label="$t('user_api__allow_show_update_alert')" @change="handleChangeAllowUpdateAlert(api, $event)")
            base-checkbox(:id="`user_api_enabled_${api.id}`" :model-value="true" :disabled="saving" :label="$t('user_api__enable_source')" @update:model-value="handleToggle(api, $event)")
            base-btn(:class="$style.listBtn" outline :disabled="saving" :aria-label="$t('user_api__btn_remove')" @click.stop="handleRemove(api)")
              svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
                use(xlink:href="#icon-delete")
        div(v-if="!enabledSources.length" :class="$style.groupEmpty") {{ $t('user_api__no_enabled_sources') }}
      section(:class="$style.sourceGroup")
        h3(:class="$style.groupTitle") {{ $t('user_api__disabled_sources') }}
        ul(data-testid="disabled-source-list")
          li(v-for="api in disabledSources" :key="api.id" :class="$style.listItem")
            div(:class="$style.listLeft")
              h3
                | {{ api.name }}
                span(v-if="api.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
                span(v-if="api.author") {{ api.author }}
              p {{ api.description }}
              div
                base-checkbox(:id="`user_api_alert_${api.id}`" v-model="api.allowShowUpdateAlert" :class="$style.checkbox" :label="$t('user_api__allow_show_update_alert')" @change="handleChangeAllowUpdateAlert(api, $event)")
            base-checkbox(:id="`user_api_enabled_${api.id}`" :model-value="false" :disabled="saving" :label="$t('user_api__enable_source')" @update:model-value="handleToggle(api, $event)")
            base-btn(:class="$style.listBtn" outline :disabled="saving" :aria-label="$t('user_api__btn_remove')" @click.stop="handleRemove(api)")
              svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
                use(xlink:href="#icon-delete")
        div(v-if="!disabledSources.length" :class="$style.groupEmpty") {{ $t('user_api__no_disabled_sources') }}
    ul.scroll(v-else-if="apiList.length" :class="$style.content")
      li(v-for="api in apiList" :key="api.id" :class="[$style.listItem, {[$style.active]: appSetting['common.apiSource'] == api.id}]")
        div(:class="$style.listLeft")
          h3
            | {{ api.name }}
            span(v-if="api.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
            span(v-if="api.author") {{ api.author }}
          p {{ api.description }}
          div
            base-checkbox(:id="`user_api_${api.id}`" v-model="api.allowShowUpdateAlert" :class="$style.checkbox" :label="$t('user_api__allow_show_update_alert')" @change="handleChangeAllowUpdateAlert(api, $event)")
        base-btn(:class="$style.listBtn" outline :aria-label="$t('user_api__btn_remove')" @click.stop="handleRemove(api)")
          svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
            use(xlink:href="#icon-delete")
    div(v-else :class="$style.content")
      div(:class="$style.noitem") {{ $t('user_api__noitem') }}
    div(:class="$style.note")
      p(:class="[$style.ruleLink]")
        | {{ $t('user_api__readme') }}
        span.hover.underline(aria-label="https://github.com/appdev/TuneFlow/blob/main/FAQ.md" @click="handleOpenUrl('https://github.com/appdev/TuneFlow/blob/main/FAQ.md')") FAQ
      p {{ $t('user_api__note') }}
    div(:class="$style.footer")
      input(ref="sourceFileInput" :class="$style.fileInput" type="file" accept=".js,text/javascript,application/javascript" @change="handleLocalFileChange")
      base-btn(data-testid="user-api-import-network" :class="$style.footerBtn" :disabled="saving" @click="handleNetworkImport") {{ $t('user_api__btn_import_online') }}
      base-btn(data-testid="user-api-import-local" :class="$style.footerBtn" :disabled="saving" @click="handleLocalImport") {{ $t('user_api__btn_import') }}
      //- base-btn(:class="$style.footerBtn" @click="handleExport") {{ $t('user_api__btn_export') }}
    UserApiOnlineImportModal(v-model:show="isShowOnlineImportModal" @imported="handleImportResult")
</template>

<script setup>
import { importUserApi, removeUserApi, setAllowShowUserApiUpdateAlert, configureUserApiSources } from '@renderer/utils/ipc'
import { openUrl } from '@web-runtime/browser'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { userApi } from '@renderer/store'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { computed, nextTick, onMounted, ref, useCssModule, watch } from '@common/utils/vueTools'
import { MAX_SOURCE_SCRIPT_BYTES } from '@common/constants'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import useDrag from '@renderer/utils/compositions/useDrag'
import { moveSource, nextLegacySource, splitSourceChain, toggleSource } from '@renderer/core/userApiSourceChain'

import UserApiOnlineImportModal from './UserApiOnlineImportModal.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:modelValue'])
const t = useI18n()
const styles = useCssModule()
const isWebRuntime = globalThis.tuneFlowWebRuntime != null
const isShowOnlineImportModal = ref(false)
const sourceFileInput = ref(null)
const enabledListElement = ref(null)
const saving = ref(false)
const apiList = computed(() => userApi.list)
const groups = computed(() => splitSourceChain(userApi.list))
const enabledSources = computed(() => groups.value.enabled)
const disabledSources = computed(() => groups.value.disabled)

const syncLegacySource = (list) => {
  if (!isWebRuntime) return
  const enabledIds = splitSourceChain(list).enabled.map(source => source.id)
  const builtInIds = apiSourceInfo.filter(source => !source.disabled).map(source => source.id)
  const nextSource = nextLegacySource(enabledIds, builtInIds)
  if (nextSource && nextSource !== appSetting['common.apiSource']) updateSetting({ 'common.apiSource': nextSource })
}

const submitSourceIds = async(sourceIds) => {
  if (!isWebRuntime || saving.value) return
  const confirmed = [...userApi.list]
  saving.value = true
  try {
    userApi.list = await configureUserApiSources(sourceIds)
    syncLegacySource(userApi.list)
  } catch (error) {
    userApi.list = confirmed
    void dialog({
      message: t('user_api__source_chain_save_failed', { message: error instanceof Error ? error.message : String(error) }),
      confirmButtonText: t('ok'),
    })
  } finally {
    saving.value = false
  }
}

const handleToggle = (api, enabled) => {
  const enabledIds = enabledSources.value.map(source => source.id)
  void submitSourceIds(toggleSource(enabledIds, api.id, enabled))
}

let setDragDisabled = () => {}
if (isWebRuntime) {
  const drag = useDrag({
    dom_list: enabledListElement,
    dragingItemClassName: styles.draggingItem,
    forceFallback: true,
    onUpdate(newIndex, oldIndex) {
      const enabledIds = enabledSources.value.map(source => source.id)
      void submitSourceIds(moveSource(enabledIds, oldIndex, newIndex))
    },
  })
  setDragDisabled = (disabled) => {
    drag.setDisabled(disabled)
  }
}

const updateDragState = () => {
  setDragDisabled(saving.value || enabledSources.value.length < 2)
}
watch(() => [saving.value, enabledSources.value.length], updateDragState)
watch(() => props.modelValue, async(show) => {
  if (!show) return
  await nextTick()
  updateDragState()
})
onMounted(updateDragState)

const handleImportResult = ({ apiList: nextList }) => {
  userApi.list = nextList
  syncLegacySource(nextList)
}
const handleImport = async(script) => {
  try {
    handleImportResult(await importUserApi(script))
  } catch (error) {
    void dialog(t('user_api_import__failed', { message: error instanceof Error ? error.message : String(error) }))
  }
}
const canImport = () => {
  if (!saving.value && userApi.list.length < 20) return true
  if (saving.value) return false
  void dialog({ message: t('user_api__max_tip'), confirmButtonText: t('ok') })
  return false
}
const handleNetworkImport = () => {
  if (canImport()) isShowOnlineImportModal.value = true
}
const handleLocalImport = () => {
  if (canImport()) sourceFileInput.value?.click()
}
const handleLocalFileChange = async(event) => {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > MAX_SOURCE_SCRIPT_BYTES) {
    void dialog(t('user_api_import__failed', { message: t('user_api__script_too_large') }))
    return
  }
  await handleImport(await file.text())
}
const handleRemove = async(api) => {
  if (saving.value) return
  const confirmed = [...userApi.list]
  saving.value = true
  try {
    userApi.list = await removeUserApi([api.id])
    if (isWebRuntime) syncLegacySource(userApi.list)
    else if (appSetting['common.apiSource'] === api.id) {
      const fallback = apiSourceInfo.find(source => !source.disabled) ?? userApi.list[0]
      updateSetting({ 'common.apiSource': fallback?.id ?? '' })
    }
  } catch (error) {
    userApi.list = confirmed
    void dialog({ message: error instanceof Error ? error.message : String(error), confirmButtonText: t('ok') })
  } finally {
    saving.value = false
  }
}
const handleClose = () => {
  emit('update:modelValue', false)
}
const handleOpenUrl = url => {
  openUrl(url)
}
const handleChangeAllowUpdateAlert = (api, enable) => {
  void setAllowShowUserApiUpdateAlert(api.id, enable)
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 8px;
  max-width: 550px;
  min-width: 300px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}

.name {
  color: var(--color-primary);
}

.checkbox {
  margin-top: 3px;
  font-size: 14px;
  opacity: .86;
}

.content {
  flex: auto;
  min-height: 80px;
  max-height: 100%;
  margin-top: 15px;
  padding: 0 7px;
}
.sourceGroup {
  + .sourceGroup {
    margin-top: 18px;
  }
}
.groupTitle {
  padding: 0 10px 6px;
  font-size: 13px;
  color: var(--color-font-label);
}
.groupEmpty {
  padding: 18px 10px;
  color: var(--color-font-label);
  text-align: center;
}
.listItem {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  transition: background-color 0.2s ease;
  padding: 15px 10px;
  border-radius: @radius-border;
  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &.active {
    background-color: var(--color-primary-background-active);
  }
  h3 {
    font-size: 15px;
    color: var(--color-font);
    word-break: break-all;
    span {
      font-size: 12px;
      color: var(--color-font-label);
      margin-left: 6px;
    }
  }
  p {
    margin-top: 5px;
    font-size: 14px;
    color: var(--color-font-label);
    word-break: break-all;
  }
}
.enabledItem {
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
}
.draggingItem {
  background-color: var(--color-primary-background-hover) !important;
}
.dragHandle {
  flex: none;
  margin-right: 8px;
  color: var(--color-font-label);
  letter-spacing: -3px;
}
.priority {
  flex: none;
  min-width: 42px;
  margin-right: 8px;
  font-size: 12px;
  color: var(--color-primary);
}
.noitem {
  height: 100px;
  font-size: 18px;
  color: var(--color-font-label);
  display: flex;
  justify-content: center;
  align-items: center;
}
.listLeft {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
}
.listBtn {
  flex: none;
  height: 30px;
  width: 30px;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  svg {
    width: 60%;
  }
}
.note {
  padding: 0 7px;
  margin-top: 15px;
  font-size: 12px;
  line-height: 1.25;
  color: var(--color-font);
  p {
    + p {
      margin-top: 5px;
    }
  }
}
.footer {
  padding: 0 7px;
  margin-top: 15px;
  display: flex;
  flex-flow: row wrap;
  gap: 10px;
}
.fileInput {
  display: none;
}
.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  width: 150px;
  .mixin-ellipsis-1();
}
.ruleLink {
  .mixin-ellipsis-1();
}

</style>
