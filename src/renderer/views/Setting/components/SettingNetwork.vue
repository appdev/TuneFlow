<template lang="pug">
dt#network {{ $t('setting__network') }}
dd
  h3#network_service_title {{ $t('setting__network_service_title') }}
  div
    .p
      label.origin-label(for="settings_service_lan_origin") {{ $t('setting__network_service_lan_origin') }}
      .origin-description {{ $t('setting__network_service_lan_origin_tip') }}
      base-input#settings_service_lan_origin(data-testid="settings-service-lan-origin" :model-value="appSetting['service.lanOrigin']" :placeholder="$t('setting__network_service_lan_origin_placeholder')" @update:model-value="setLanOrigin")
    .p
      label.origin-label(for="settings_service_external_origin") {{ $t('setting__network_service_external_origin') }}
      .origin-description {{ $t('setting__network_service_external_origin_tip') }}
      base-input#settings_service_external_origin(data-testid="settings-service-external-origin" :model-value="appSetting['service.externalOrigin']" :placeholder="$t('setting__network_service_external_origin_placeholder')" @update:model-value="setExternalOrigin")
  h3#network_proxy_title {{ $t('setting__network_proxy_title') }}
  div
    .p
      base-checkbox(id="setting_network_proxy_enable" :model-value="appSetting['network.proxy.enable']" :label="$t('setting__is_enable')" @update:model-value="updateSetting({'network.proxy.enable': $event})")
    .p
      base-input(:model-value="appSetting['network.proxy.host']" :placeholder="proxy.envProxy ? proxy.envProxy.host : $t('setting__network_proxy_host')" @update:model-value="setHost")
    .p
      base-input(:model-value="appSetting['network.proxy.port']" :placeholder="proxy.envProxy ? proxy.envProxy.port : $t('setting__network_proxy_port')" @update:model-value="setPort")
  h3#recommendation_ai_title {{ $t('setting__recommendation_ai_title') }}
  div
    .p
      base-checkbox(id="setting_recommendation_ai_enable" :model-value="appSetting['recommendation.ai.enabled']" :label="$t('setting__is_enable')" @update:model-value="updateSetting({'recommendation.ai.enabled': $event})")
    .p
      label.origin-label(for="setting_recommendation_ai_base_url") {{ $t('setting__recommendation_ai_base_url') }}
      base-input#setting_recommendation_ai_base_url(:model-value="appSetting['recommendation.ai.baseUrl']" placeholder="https://api.openai.com/v1" @update:model-value="setAIBaseUrl")
    .p
      label.origin-label(for="setting_recommendation_ai_model") {{ $t('setting__recommendation_ai_model') }}
      base-input#setting_recommendation_ai_model(:model-value="appSetting['recommendation.ai.model']" placeholder="gpt-5-mini" @update:model-value="setAIModel")
    .origin-description {{ $t('setting__recommendation_ai_key_tip') }}
    .ai-actions
      button(type="button" :disabled="aiBusy" @click="testAI") {{ $t('setting__recommendation_ai_test') }}
      button(type="button" :disabled="aiBusy || !appSetting['recommendation.ai.enabled']" @click="reanalyzeAI") {{ $t('setting__recommendation_ai_reanalyze') }}
      span(v-if="aiResult") {{ aiResult }}

</template>

<script>
import { onBeforeUnmount, ref } from '@common/utils/vueTools'
import { proxy } from '@renderer/store'
import { debounce } from '@common/utils'

import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingNetwork',
  setup() {
    const setLanOrigin = debounce(origin => {
      updateSetting({ 'service.lanOrigin': origin.trim() })
    }, 500)
    const setExternalOrigin = debounce(origin => {
      updateSetting({ 'service.externalOrigin': origin.trim() })
    }, 500)
    const setHost = debounce(host => {
      updateSetting({ 'network.proxy.host': host.trim() })
    }, 500)
    const setPort = debounce(port => {
      updateSetting({ 'network.proxy.port': port.trim() })
    }, 500)
    const setAIBaseUrl = debounce(value => { updateSetting({ 'recommendation.ai.baseUrl': value.trim() }) }, 500)
    const setAIModel = debounce(value => { updateSetting({ 'recommendation.ai.model': value.trim() }) }, 500)
    const aiBusy = ref(false)
    const aiResult = ref('')
    const aiRequest = async(path) => {
      aiBusy.value = true
      aiResult.value = ''
      try {
        const response = await fetch(path, { method: 'POST' })
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error?.message ?? String(response.status))
        aiResult.value = body.data?.ok === false ? (body.data.errorCode ?? 'Unavailable') : window.i18n.t('setting__recommendation_ai_success')
      } catch (error) { aiResult.value = error instanceof Error ? error.message : String(error) } finally { aiBusy.value = false }
    }
    const testAI = async() => { await aiRequest('/api/v1/recommendations/ai/test') }
    const reanalyzeAI = async() => { await aiRequest('/api/v1/recommendations/ai/reanalyze') }

    onBeforeUnmount(() => {
      if (appSetting['network.proxy.enable'] && !appSetting['network.proxy.host']) proxy.enable = false
    })

    return {
      appSetting,
      updateSetting,
      setLanOrigin,
      setExternalOrigin,
      setHost,
      setPort,
      proxy,
      setAIBaseUrl,
      setAIModel,
      aiBusy,
      aiResult,
      testAI,
      reanalyzeAI,
    }
  },
}
</script>

<style lang="less" scoped>
.origin-label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
}

.origin-description {
  margin-bottom: 8px;
  color: var(--color-font-label);
  font-size: 12px;
}

.p + .p {
  margin-top: 12px;
}

.ai-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 8px; color: var(--color-font); background: var(--color-primary-light-300-alpha-500); cursor: pointer; } button:disabled { opacity: .45; cursor: default; } span { color: var(--color-font-label); font-size: 12px; } }
</style>
