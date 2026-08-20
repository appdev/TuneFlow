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

</template>

<script>
import { onBeforeUnmount } from '@common/utils/vueTools'
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
</style>
