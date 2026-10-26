<template>
  <div :class="$style.appearance">
    <div :class="$style.options" role="group" :aria-label="$t('theme_appearance')">
      <button v-for="mode in modes" :key="mode" type="button" :aria-pressed="modelValue == mode" :class="[$style.option, {[$style.selected]: modelValue == mode}]" @click="$emit('change', mode)" @keydown="onKeydown($event, mode)">
        <span :class="[$style.preview, $style[mode]]" aria-hidden="true">
          <span :class="$style.sidebar"><i /><i /><i /></span>
          <span :class="$style.lines"><i /><i /><i /></span>
          <svg v-if="mode == 'time'" :class="$style.clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></svg>
          <span v-if="modelValue == mode" :class="$style.check"><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg></span>
        </span>
        <span :class="$style.label">{{ $t(`theme_appearance_${mode}`) }}</span>
      </button>
    </div>
    <form v-if="modelValue == 'time'" :class="$style.schedule" @submit.prevent="saveSchedule">
      <label>{{ $t('theme_schedule_day') }}<input v-model="dayStart" type="time" required :aria-invalid="invalid" @input="saved = false"></label>
      <label>{{ $t('theme_schedule_night') }}<input v-model="nightStart" type="time" required :aria-invalid="invalid" @input="saved = false"></label>
      <button type="submit" :disabled="invalid || !changed">{{ $t('theme_schedule_save') }}</button>
      <span v-if="invalid || saved" :class="$style.feedback" role="status">{{ $t(invalid ? 'theme_schedule_invalid' : 'theme_schedule_saved') }}</span>
    </form>
    <p :class="$style.tip">{{ $t(modelValue == 'time' ? 'theme_appearance_time_tip' : 'theme_appearance_tip') }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ThemeAppearance } from '@common/theme/appearance'
import { computed, ref, watch } from '@common/utils/vueTools'
import { getThemeSchedule, isValidSchedule } from '@common/theme/schedule'
import { appSetting, updateSetting } from '@renderer/store/setting'
defineProps<{ modelValue: ThemeAppearance }>()
const emit = defineEmits<{ change: [mode: ThemeAppearance] }>()
const dayStart = ref(getThemeSchedule(appSetting).dayStart)
const nightStart = ref(getThemeSchedule(appSetting).nightStart)
const saved = ref(false)
const invalid = computed(() => !isValidSchedule(dayStart.value, nightStart.value))
const changed = computed(() => dayStart.value != appSetting['theme.dayStart'] || nightStart.value != appSetting['theme.nightStart'])
watch(() => [appSetting['theme.dayStart'], appSetting['theme.nightStart']], () => {
  const schedule = getThemeSchedule(appSetting)
  dayStart.value = schedule.dayStart
  nightStart.value = schedule.nightStart
})
const saveSchedule = () => {
  if (invalid.value) return
  updateSetting({ 'theme.dayStart': dayStart.value, 'theme.nightStart': nightStart.value })
  saved.value = true
}
const modes: ThemeAppearance[] = ['light', 'dark', 'system', 'time']
const onKeydown = (event: KeyboardEvent, mode: ThemeAppearance) => {
  const index = modes.indexOf(mode)
  const next = event.key == 'ArrowRight' ? (index + 1) % modes.length : event.key == 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key == 'Home' ? 0 : event.key == 'End' ? modes.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.parentElement?.querySelectorAll('button')[next]?.focus()
  emit('change', modes[next])
}
</script>

<style module lang="less">
.appearance { padding-top: 4px; }
.options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; max-width: 448px; }
.option { padding: 0; border: 0; background: none; color: var(--color-font-label); cursor: pointer; font: inherit; min-width: 0; border-radius: 10px; }
.preview { position: relative; display: flex; gap: 9px; height: 62px; padding: 11px 9px; box-sizing: border-box; border-radius: 9px; border: 1px solid rgba(80, 90, 100, .14); background: #f4f5f7; box-shadow: 0 2px 5px rgba(0, 0, 0, .04); transition: outline-color .18s, transform .18s; outline: 2px solid transparent; outline-offset: 3px; }
.dark { background: #25272d; border-color: rgba(255,255,255,.12); }
.system, .time { background: linear-gradient(90deg, #f4f5f7 50%, #25272d 50%); }
.sidebar { width: 18%; flex: none; display: flex; flex-direction: column; gap: 5px; border-right: 1px solid rgba(145, 150, 158, .2); padding-right: 7px; }
.lines { flex: 1; display: flex; flex-direction: column; gap: 6px; padding-top: 1px; }
.sidebar i, .lines i { display: block; height: 4px; border-radius: 3px; background: #bdc2ca; }
.lines i:nth-child(2) { width: 70%; background: var(--color-primary); opacity: .7; }
.lines i:last-child { width: 86%; }
.dark i { background: #5c606a; }
.clock { position: absolute; right: 8px; bottom: 8px; width: 18px; height: 18px; stroke: #e7e9ed; fill: #25272d; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.check { position: absolute; bottom: -5px; right: -5px; width: 16px; height: 16px; border: 2px solid var(--color-content-background); border-radius: 50%; background: var(--color-primary); display: grid; place-items: center; }
.check svg { width: 12px; height: 12px; fill: none; stroke: var(--color-content-background); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.label { display: block; margin-top: 12px; font-size: 13px; line-height: 1.5; }
.selected { color: var(--color-font); .preview { outline-color: var(--color-primary); } .label { font-weight: 600; } }
.option:hover .preview { transform: translateY(-1px); }
.option:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 7px; }
.tip { margin: 17px 0 0; font-size: 12px; line-height: 1.65; color: var(--color-font-label); max-width: 560px; }
.schedule { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-top: 22px; max-width: 560px; }
.schedule label { display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--color-font-label); }
.schedule input, .schedule button { box-sizing: border-box; height: 36px; border: 1px solid var(--color-primary-alpha-600); border-radius: 8px; padding: 0 12px; font: inherit; color: var(--color-font); background: var(--color-content-background); }
.schedule input { color-scheme: light dark; min-width: 115px; }
.schedule input::-webkit-calendar-picker-indicator { filter: invert(.5); }
.schedule button { cursor: pointer; color: var(--color-primary); }
.schedule button:disabled { opacity: .45; cursor: default; }
.schedule input:focus-visible, .schedule button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.feedback { flex-basis: 100%; color: var(--color-font-label); font-size: 12px; line-height: 1.6; }
@media (prefers-reduced-motion: reduce) { .preview { transition: none; } }
</style>
