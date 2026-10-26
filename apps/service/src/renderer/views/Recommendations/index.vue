<template>
  <div :class="$style.page" data-testid="recommendations-page">
    <header :class="$style.header">
      <div>
        <p :class="$style.eyebrow">{{ $t('recommendations__daily') }}</p>
        <h1>{{ $t('recommendations') }}</h1>
        <p v-if="daily?.generatedAt" :class="$style.meta">{{ daily.localDate }} · v{{ daily.version }} · {{ daily.sourceCoverage.join(' / ') }}</p>
      </div>
      <div :class="$style.actions">
        <button :disabled="!daily?.items.length" data-testid="recommendations-play-all" @click="playAll">{{ $t('recommendations__play_all') }}</button>
        <button :disabled="refreshing" data-testid="recommendations-refresh" @click="refresh">{{ refreshing ? $t('recommendations__refreshing') : $t('recommendations__refresh') }}</button>
      </div>
    </header>

    <section :class="$style.radio" data-testid="radio-launch-card">
      <div>
        <p :class="$style.eyebrow">{{ $t('radio__eyebrow') }}</p>
        <h2>{{ $t('radio__title') }}</h2>
        <p>{{ $t('radio__description') }}</p>
        <small v-if="radioError" role="alert">{{ radioError }}</small>
      </div>
      <button :disabled="radioLoading" data-testid="radio-start" @click="startDedicatedRadio">
        {{ radioLoading ? $t('radio__starting') : $t('radio__start') }}
      </button>
    </section>

    <p v-if="error" :class="$style.error" role="alert">{{ error }} <button @click="load">{{ $t('recommendations__retry') }}</button></p>
    <div v-else-if="loading || daily?.status === 'warming'" :class="$style.empty">{{ $t('recommendations__warming') }}</div>
    <p v-else-if="daily?.status === 'degraded'" :class="$style.warning">{{ $t('recommendations__degraded') }}</p>
    <div v-if="daily?.items.length" :class="$style.list" role="list">
      <article v-for="(item, index) in daily.items" :key="item.recommendationItemId" :class="$style.item" role="listitem" :data-recommendation-id="item.recommendationItemId">
        <button :class="$style.track" @click="play(index)">
          <span :class="$style.number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span :class="$style.identity"><strong>{{ item.track.name }}</strong><small>{{ item.track.singer }}</small></span>
          <span :class="$style.reason">{{ reason(item) }}</span>
          <span :class="[$style.badge, item.bucket === 'new' ? $style.new : $style.familiar]">{{ item.bucket === 'new' ? $t('recommendations__new') : $t('recommendations__familiar') }}</span>
        </button>
        <button :class="$style.dismiss" :aria-label="$t('recommendations__not_interested')" @click="dismiss(item)">×</button>
      </article>
    </div>
    <div v-else-if="!loading && daily?.status !== 'warming'" :class="$style.empty">{{ $t('recommendations__empty') }}</div>
  </div>
</template>

<script setup lang="ts">
import { useRecommendations } from './state'
import { playRecommendationQueue } from './player'
import type { RecommendationItem } from './api'
import { startDedicatedRadio } from '../Radio/player'
import { radioError, radioLoading } from '../Radio/state'

const { daily, loading, refreshing, error, load, refresh, dismiss } = useRecommendations()
const play = (index: number) => { if (daily.value != null) playRecommendationQueue(daily.value.items, index) }
const playAll = () => { play(0) }
const reason = (item: RecommendationItem): string => item.reason.labels.length > 0 ? item.reason.labels.join(' · ') : window.i18n.t(`recommendations__reason_${item.reason.type}` as never)
</script>

<style lang="less" module>
.page { height: 100%; overflow: auto; box-sizing: border-box; padding: 28px clamp(16px, 4vw, 54px) 64px; }
.header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; h1 { margin: 2px 0 8px; font-size: clamp(28px, 4vw, 44px); } }
.eyebrow { margin: 0; color: var(--color-primary); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
.meta { margin: 0; opacity: .65; }
.actions { display: flex; gap: 10px; button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 999px; color: var(--color-font); background: var(--color-primary-light-300-alpha-700); cursor: pointer; } button:disabled { opacity: .45; cursor: default; } }
.radio { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin: 0 0 22px; padding: 22px 24px; border: 1px solid var(--color-primary-light-300-alpha-500); border-radius: 18px; background: linear-gradient(120deg, var(--color-primary-light-300-alpha-300), var(--color-content-background)); h2 { margin: 3px 0 7px; font-size: 24px; } p { margin: 0; opacity: .72; } small { display: block; margin-top: 8px; color: #d84a4a; } button { flex: none; min-width: 132px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 999px; color: var(--color-primary-font); background: var(--color-primary); cursor: pointer; } button:disabled { opacity: .55; cursor: default; } }
.list { display: grid; gap: 8px; }
.item { display: flex; min-height: 62px; border-radius: 12px; background: var(--color-content-background); overflow: hidden; }
.track { flex: 1; min-width: 0; display: grid; grid-template-columns: 44px minmax(150px, 1.4fr) minmax(120px, 1fr) auto; align-items: center; gap: 12px; border: 0; padding: 8px 12px; color: var(--color-font); background: transparent; text-align: left; cursor: pointer; }
.number { opacity: .45; font-variant-numeric: tabular-nums; }
.identity { min-width: 0; display: flex; flex-direction: column; strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { margin-top: 4px; opacity: .65; } }
.reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .65; }
.badge { padding: 4px 9px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
.new { color: var(--color-primary); background: var(--color-primary-light-300-alpha-300); }
.familiar { opacity: .75; background: var(--color-primary-light-500-alpha-300); }
.dismiss { width: 48px; min-height: 44px; border: 0; color: var(--color-font); background: transparent; font-size: 22px; cursor: pointer; opacity: .55; }
.dismiss:hover { opacity: 1; }
.empty, .error, .warning { padding: 36px; border-radius: 14px; background: var(--color-content-background); text-align: center; }
.error { color: #d84a4a; }
.warning { margin-bottom: 12px; padding: 12px 16px; color: #9a6500; text-align: left; }
@media (max-width: 700px) {
  .page { padding: 18px 12px 50px; }
  .header { align-items: stretch; flex-direction: column; }
  .actions button { flex: 1; }
  .radio { align-items: stretch; flex-direction: column; padding: 18px; }
  .radio button { width: 100%; }
  .track { grid-template-columns: 32px minmax(0, 1fr) auto; }
  .reason { display: none; }
}
</style>
