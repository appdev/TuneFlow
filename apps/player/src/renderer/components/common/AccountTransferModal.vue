<template>
  <material-modal :show="visible" :close-btn="false" max-height="92%" @close="close">
    <main :class="$style.main">
      <header><h2>连接手机</h2><button type="button" aria-label="关闭" @click="close">×</button></header>
      <p>电脑和手机连接同一 Wi-Fi。在安卓的 QQ 音乐账号页选择「从电脑导入」，扫描下方二维码。</p>
      <p v-if="info" :class="$style.account">{{ info.account }}</p>
      <div v-if="info && state == 'waiting'" :class="$style.pairing">
        <img :src="info.images[address]" width="216" height="216" alt="临时账号配对二维码">
        <label v-if="info.addresses.length > 1">电脑地址
          <select v-model="address"><option v-for="(host, index) in info.addresses" :key="host" :value="index">{{ host }}</option></select>
        </label>
        <span>{{ seconds }} 秒后失效 · 仅限本次导入</span>
        <button type="button" @click="copy">{{ copied ? '已复制配对码' : '复制配对码' }}</button>
      </div>
      <p :class="$style.status" role="status">{{ message }}</p>
      <p v-if="state == 'waiting' && info" :class="$style.tip">无法连接时请检查 Wi-Fi 和电脑防火墙；有多个地址可切换后重扫。配对码仅给自己的手机使用。</p>
      <footer><base-btn v-if="!busy && state != 'waiting'" min @click="start">重新生成</base-btn><base-btn min @click="close">{{ state == 'sent' ? '完成' : '取消' }}</base-btn></footer>
    </main>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { clipboard } from 'electron'
import { startAccountTransfer, getAccountTransferState, cancelAccountTransfer } from '@renderer/utils/ipc'
import type { AccountTransferInfo, AccountTransferState } from '@common/types/accountTransfer'
const props = defineProps<{ visible: boolean }>()
const emit = defineEmits(['update:visible'])
const info = ref<AccountTransferInfo>()
const state = ref<AccountTransferState>('cancelled')
const busy = ref(false)
const error = ref('')
const address = ref(0)
const copied = ref(false)
const now = ref(Date.now())
let revision = 0
let timer: ReturnType<typeof setInterval> | undefined
let polling = false
const seconds = computed(() => Math.max(0, Math.ceil(((info.value?.expiresAt ?? now.value) - now.value) / 1000)))
const message = computed(() => error.value || (busy.value ? '正在验证账号并生成配对码…' : state.value == 'sent' ? '已加密发送，请在手机上确认导入。此配对码已失效。' : state.value == 'expired' ? '配对码已过期，请重新生成。' : state.value == 'waiting' ? '等待手机连接…' : '配对已结束。'))
const cancel = () => {
  revision++
  clearInterval(timer)
  if (info.value) void cancelAccountTransfer(info.value.id).catch(() => {})
  info.value = undefined
}
const close = () => { cancel(); emit('update:visible', false) }
const copy = () => { if (info.value && state.value == 'waiting') { clipboard.writeText(info.value.links[address.value]); copied.value = true } }
const start = async() => {
  cancel()
  const current = revision
  busy.value = true
  error.value = ''
  copied.value = false
  address.value = 0
  try {
    const result = await startAccountTransfer()
    if (current != revision || !props.visible) { await cancelAccountTransfer(result.id); return }
    info.value = result
    state.value = 'waiting'
    now.value = Date.now()
    timer = setInterval(() => {
      now.value = Date.now()
      if (polling) return
      polling = true
      void getAccountTransferState(result.id).then(value => {
        if (current != revision) return
        state.value = value
        if (value != 'waiting') { clearInterval(timer); result.links = []; result.images = [] }
      }).catch(() => { if (current == revision) { state.value = 'cancelled'; error.value = '无法确认连接状态，请重新生成。'; clearInterval(timer) } }).finally(() => { polling = false })
    }, 1000)
  } catch (err) {
    if (current != revision) return
    const text = String(err)
    error.value = text.includes('login_required') ? '请先在电脑登录有效的 QQ 音乐账号。' : text.includes('transfer_no_network') ? '未找到局域网地址，请连接 Wi-Fi 或有线网络后重试。' : '暂时无法生成配对码，请重试。'
    state.value = 'cancelled'
  } finally { if (current == revision) busy.value = false }
}
watch(() => props.visible, visible => { if (visible) void start(); else cancel() })
onBeforeUnmount(cancel)
</script>

<style lang="less" module>
.main { width: min(420px, 78vw); padding: 18px 22px; max-height: calc(90vh - 20px); overflow: auto; color: var(--color-font);
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  h2 { font-size: 20px; } p { font-size: 13px; line-height: 1.6; margin: 10px 0; }
  button, select { color: var(--color-font); background: var(--color-primary-alpha-900); border-radius: 8px; padding: 8px 12px; border: 0; cursor: pointer; }
  option { color: var(--color-font); background: var(--color-main-background); }
  header button { background: transparent; font-size: 24px; }
  footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px; }
}
.account { font-weight: 600; }
.pairing { display: flex; align-items: center; flex-direction: column; gap: 8px; img { border-radius: 12px; max-width: 100%; height: auto; } span, label { font-size: 12px; } select { margin-left: 8px; } }
.status { text-align: center; }
.tip { opacity: .7; }
</style>
