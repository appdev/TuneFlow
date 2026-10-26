<template>
  <section :class="[$style.target, { [$style.compact]: compact }]" :aria-busy="working">
    <div :class="$style.row">
      <SourceIcon source="tx" :size="30" />
      <div :class="$style.copy">
        <strong>{{ $t('qq_favorite_title') }}</strong>
        <span>{{ $t(supported ? 'qq_favorite_hint' : 'qq_favorite_supported') }}</span>
      </div>
      <base-btn type="button" :disabled="disabled || working || !supported || status == 'added'" @click="submit">
        {{ $t(working ? 'qq_favorite_working' : status == 'added' ? 'qq_favorite_added_button' : status == 'login_required' ? 'qq_favorite_login' : needsCheck ? 'qq_favorite_check' : 'qq_favorite_add') }}
      </base-btn>
    </div>
    <p v-if="status" role="status" :class="$style.message">{{ $t('qq_favorite_' + status) }}<span v-if="errorCode != null"> {{ $t('qq_favorite_error_code', { code: errorCode }) }}</span></p>
    <p v-if="localSync" role="status" :class="$style.message">{{ $t(localSync) }}</p>
  </section>
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { addQQFavoriteSong, loginMusicAccount } from '@renderer/utils/ipc'
import { syncQQFavorites } from '@renderer/store/list/syncSourceList'
import SourceIcon from './SourceIcon.vue'

export default {
  components: { SourceIcon },
  props: {
    musicInfo: { type: Object, required: true },
    disabled: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
  },
  emits: ['busy'],
  setup(props, { emit }) {
    const status = ref('')
    const errorCode = ref(null)
    const working = ref(false)
    const localSync = ref('')
    const needsCheck = computed(() => status.value == 'unknown' || status.value == 'unconfirmed')
    const supported = computed(() => props.musicInfo.source == 'tx' && /^[a-zA-Z0-9]{1,64}$/.test(String(props.musicInfo.meta?.songId ?? '')))
    let generation = 0
    watch(() => props.musicInfo, () => { generation++; status.value = ''; errorCode.value = null; localSync.value = '' })
    onBeforeUnmount(() => { generation++ })
    const submit = async() => {
      if (props.disabled || working.value || !supported.value || status.value == 'added') return
      const current = generation
      const needsLogin = status.value == 'login_required'
      const songMid = String(props.musicInfo.meta.songId)
      working.value = true
      errorCode.value = null
      emit('busy', true)
      try {
        if (needsLogin) {
          const result = await loginMusicAccount('tx')
          if (generation == current) status.value = result.status == 'connected' ? 'ready' : 'login_required'
        } else {
          const checking = needsCheck.value
          const result = await addQQFavoriteSong(songMid, checking ? 'check' : 'add')
          if (result.status == 'added' && result.accountId) {
            // 本地同步失败不能改变已经确认的云端收藏结果。
            if (generation == current) localSync.value = 'list_sync_favorite_pending'
            void syncQQFavorites(result.accountId).then(sync => {
              if (generation == current) localSync.value = sync.failed ? 'list_sync_favorite_failed' : sync.total ? 'list_sync_favorite_done' : 'list_sync_favorite_unlinked'
            }).catch(() => { if (generation == current) localSync.value = 'list_sync_favorite_failed' })
          }
          if (generation == current) {
            // 核对失败仍保留只读核对入口，不把下一次点击隐式变成重新写入。
            status.value = checking && result.status == 'unavailable' ? 'unknown' : result.status
            errorCode.value = result.code ?? null
          }
        }
      } catch {
        if (generation == current) status.value = needsLogin ? 'unavailable' : 'unknown'
      } finally {
        working.value = false
        emit('busy', false)
      }
    }
    return { status, errorCode, working, supported, needsCheck, submit, localSync }
  },
}
</script>

<style lang="less" module>
.target { flex: none; margin: 0 16px 16px; padding: 14px; border: 1px solid var(--color-primary-alpha-700); border-radius: 12px; }
.row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.copy { display: flex; flex: 1; min-width: 160px; flex-direction: column; gap: 6px; line-height: 1.5; }
.copy strong { font-size: 14px; color: var(--color-font); }
.copy span, .message { font-size: 12px; line-height: 1.6; color: var(--color-font-label); }
.message { margin: 10px 0 0; }
.compact { margin: 0; padding: 12px; background: rgb(from currentColor r g b / .035); border-color: rgb(from currentColor r g b / .1); }
.compact .row { gap: 10px; }
.compact .copy { min-width: 150px; }
.compact .copy strong { color: inherit; font-size: 13px; }
.compact .copy span, .compact .message { color: inherit; opacity: .65; font-size: 11px; }
.compact .row > button { width: 100%; min-height: 34px; }
</style>
