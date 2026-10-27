<template>
  <section v-if="flow" :class="$style.login" aria-label="官方扫码登录">
    <img :src="flow.image" alt="官方登录二维码"><p role="status">{{ message }}</p>
    <p>请使用 {{ provider === 'tx' ? 'QQ' : provider === 'wy' ? '网易云音乐' : '酷狗音乐' }} 扫码并在官方应用确认。登录后，各端解锁即可使用账号歌单和推荐。</p>
    <button v-if="expired || error" @click="retry++">刷新二维码</button><button @click="close">取消登录</button>
  </section>
  <p v-if="error" role="alert">{{ error }}</p>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import type { AccountProvider, AccountLogin } from '../../../../../packages/service-client/src/accounts'
import { sharedAccounts } from './accounts'
import { pollAccountLogin } from '../../../../../packages/service-client/src/accountLogin'
import { getWorkspace } from './session'
const props = defineProps<{ provider: AccountProvider, visible: boolean }>()
const emit = defineEmits<{ (event: 'connected'): void, (event: 'close'): void }>()
const flow = ref<AccountLogin>(); const error = ref(''); const message = ref('等待扫码'); const expired = ref(false); const retry = ref(0)
let generation = 0; let stopPolling: (() => void) | undefined; let cancel: (() => Promise<unknown>) | undefined
const stop = () => { generation++; stopPolling?.(); stopPolling = undefined; flow.value = undefined; if (cancel) void cancel().catch(() => {}); cancel = undefined }
const close = () => { stop(); emit('close') }
watch(() => [props.provider, props.visible, retry.value] as const, async() => {
  stop(); error.value = ''; expired.value = false; if (!props.visible) return
  const version = generation; const workspace = getWorkspace(); const api = sharedAccounts(workspace.client)
  try {
    const result = await api.login(props.provider)
    if (generation !== version || workspace !== getWorkspace()) { void api.cancel(result.id).catch(() => {}); return }
    flow.value = result; cancel = async() => api.cancel(result.id); message.value = '等待扫码'
    stopPolling = pollAccountLogin({
      expiresAt: result.expiresAt,
      active: () => generation === version && workspace === getWorkspace(),
      poll: async() => api.poll(result.id),
      status: status => {
        error.value = ''
        if (status === 'connected') { cancel = undefined; stop(); emit('connected'); emit('close'); return }
        if (status === 'expired') { expired.value = true; message.value = '二维码已过期，请重新获取'; return }
        message.value = status === 'scanned' ? '已扫码，请在官方应用确认授权' : '等待扫码'
      },
      error: (e, retrying) => {
        error.value = e instanceof Error ? e.message : '官方授权失败'
        message.value = retrying ? '登录状态查询暂时失败，正在自动重试…' : '登录未完成，请刷新二维码后重试'
      },
    })
  } catch (e) { if (generation === version) error.value = e instanceof Error ? e.message : '二维码加载失败' }
}, { immediate: true })
onBeforeUnmount(stop)
</script>
<style module lang="less">
.login { margin: 16px 0; padding: 20px; border: 1px solid var(--color-primary-light-300); border-radius: 16px; img { display: block; background: white; padding: 8px; width: 240px; height: 240px; object-fit: contain; } }
</style>
