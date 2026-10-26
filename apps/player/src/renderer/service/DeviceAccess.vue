<template>
  <section :class="$style.access" aria-label="共享账号访问">
    <div :class="$style.heading">
      <div><strong>{{ authorized ? '共享账号已解锁' : '解锁共享账号' }}</strong><p>{{ authorized ? '此应用会记住访问授权，平台账号在各端共享。' : '输入访问密码后即可使用已有的平台账号，无需重复扫码。' }}</p></div>
      <div v-if="authorized" :class="$style.actions"><button v-if="passwordConfigured" :disabled="busy" @click="clear(); editing = !editing">{{ editing ? '取消修改' : '修改访问密码' }}</button><button :disabled="busy || !passwordConfigured" @click="disconnect">退出当前访问</button></div>
    </div>
    <p v-if="loading" role="status">正在检查访问状态…</p>
    <form v-else-if="!authorized && passwordConfigured" :class="$style.form" @submit.prevent="signIn">
      <label>访问密码<input v-model="password" type="password" autocomplete="current-password" maxlength="128" :disabled="busy" required></label>
      <button :class="$style.primary" :disabled="busy || !password">{{ busy ? '正在解锁…' : '解锁并记住' }}</button>
    </form>
    <p v-else-if="!authorized">尚未设置访问密码，请先在已登录的应用中设置。全新安装可在服务端初始化密码。</p>
    <form v-if="authorized && (!passwordConfigured || editing)" :class="$style.passwordForm" @submit.prevent="savePassword">
      <p>{{ passwordConfigured ? '修改后，其他应用需要输入新密码；当前访问和平台登录会保留。' : '设置一个各端共用的访问密码，现有登录和音乐数据会保留。' }}</p>
      <div :class="$style.form">
        <label v-if="passwordConfigured">当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128" :disabled="busy" required></label>
        <label>{{ passwordConfigured ? '新密码' : '访问密码' }}<input v-model="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" :disabled="busy" placeholder="至少 8 个字符" required></label>
        <label>确认密码<input v-model="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" :disabled="busy" required></label>
        <button :class="$style.primary" :disabled="busy || password.length < 8 || !confirmation">{{ busy ? '正在保存…' : '保存访问密码' }}</button>
      </div>
    </form>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { sharedAccounts, notifyAccountsChanged } from './accounts'
import { getWorkspace, isServerBoundWeb } from './session'
const emit = defineEmits<(event: 'change', authorized: boolean) => void>()
const authorized = ref(false); const passwordConfigured = ref(false); const editing = ref(false); const loading = ref(true)
const password = ref(''); const currentPassword = ref(''); const confirmation = ref(''); const busy = ref(false); const error = ref(''); const message = ref('')
let active = true
let generation = 0
const clear = () => { password.value = ''; currentPassword.value = ''; confirmation.value = '' }
const load = async() => {
  const version = ++generation; const workspace = getWorkspace(); const api = sharedAccounts(workspace.client)
  let access: { passwordConfigured: boolean }; let unlocked = true
  try { access = await api.device() } catch (reason: any) { if (reason?.code !== 'DEVICE_AUTH_REQUIRED') throw reason; unlocked = false; access = await api.accessStatus() }
  if (!active || version !== generation || workspace !== getWorkspace()) return
  const changed = unlocked !== authorized.value
  authorized.value = unlocked; passwordConfigured.value = access.passwordConfigured; loading.value = false
  if (changed) { clear(); editing.value = false }
  emit('change', unlocked)
}
const run = async(action: () => Promise<void>) => {
  if (busy.value) return; busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (reason) { if (active) error.value = reason instanceof Error ? reason.message : '访问失败，请重试' } finally { clear(); busy.value = false }
}
const signIn = () => { void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).signIn(password.value, isServerBoundWeb ? 'Web' : '桌面'); if (!active || workspace !== getWorkspace()) return; await load(); notifyAccountsChanged() }) }
const savePassword = () => {
  if (password.value !== confirmation.value) { error.value = '两次输入的密码不一致'; return }
  void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).setPassword(password.value, passwordConfigured.value ? currentPassword.value : undefined); if (!active || workspace !== getWorkspace()) return; editing.value = false; await load(); notifyAccountsChanged(); message.value = '访问密码已保存，其他应用可输入此密码解锁' })
}
const disconnect = () => { void run(async() => { const workspace = getWorkspace(); await sharedAccounts(workspace.client).signOut(); if (!active || workspace !== getWorkspace()) return; await load(); notifyAccountsChanged() }) }
const refreshAccess = () => { if (busy.value) return; void load().catch(reason => { if (active) { loading.value = false; error.value = reason instanceof Error ? reason.message : '暂时无法检查访问状态' } }) }
onMounted(() => { refreshAccess(); window.addEventListener('qmusic-accounts-changed', refreshAccess) })
onBeforeUnmount(() => { active = false; generation++; clear(); window.removeEventListener('qmusic-accounts-changed', refreshAccess) })
</script>
<style module lang="less">
.access { padding: 18px 20px; border: 1px solid var(--q-outline); border-radius: 16px; background: var(--q-surface-soft); margin: 22px 0; }
.heading { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; strong { font-size: 14px; } p { margin: 5px 0 0 !important; color: var(--color-font-label); } }
.actions { display: flex; align-items: start; flex-wrap: wrap; gap: 8px; }
.form { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-top: 14px; label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; } input { box-sizing: border-box; min-height: 38px; width: 220px; max-width: 100%; background: var(--q-surface); color: inherit; border: 1px solid var(--q-outline); border-radius: 8px; padding: 8px 10px; } }
.passwordForm { margin-top: 12px; }
.primary { background: var(--color-primary) !important; color: var(--color-primary-light-1000) !important; border-color: transparent !important; }
</style>
