<template>
  <div :class="$style.btns" :aria-busy="disabled">
    <button v-if="playBtn" type="button" :disabled="disabled" :aria-label="$t(playing ? 'player__pause' : 'list__play')" @contextmenu.capture.stop @click.stop="handleClick('play')">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" :viewBox="playing ? '0 0 1024 1024' : '0 0 287.386 287.386'" space="preserve">
        <use :xlink:href="playing ? '#icon-pause' : '#icon-testPlay'" />
      </svg>
    </button>
    <button v-if="listAddBtn" type="button" :disabled="disabled" :aria-label="$t('list__add_to')" @contextmenu.capture.stop @click.stop="handleClick('listAdd')">
      <svg viewBox="0 0 24 24" :class="$style.outlineIcon" aria-hidden="true"><path d="M4 5h11M4 10h11M4 15h7M17 13v8m-4-4h8" /></svg>
    </button>
    <button v-if="downloadBtn && appSetting['download.enable']" type="button" :disabled="disabled" :aria-label="$t('list__download')" @contextmenu.capture.stop @click.stop="handleClick('download')">
      <svg viewBox="0 0 24 24" :class="$style.outlineIcon" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>
    </button>
    <button v-if="startBtn" type="button" :disabled="disabled" :aria-label="$t('list__start')" @contextmenu.capture.stop @click.stop="handleClick('start')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
        <use xlink:href="#icon-play" />
      </svg>
    </button>
    <button v-if="pauseBtn" type="button" :disabled="disabled" :aria-label="$t('list__pause')" @contextmenu.capture.stop @click.stop="handleClick('pause')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
        <use xlink:href="#icon-pause" />
      </svg>
    </button>
    <button v-if="fileBtn" type="button" :disabled="disabled" :aria-label="$t('list__file')" @contextmenu.capture.stop @click.stop="handleClick('file')">
      <svg viewBox="0 0 24 24" :class="$style.outlineIcon" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3z" /><path d="M3 10h18" /></svg>
    </button>
    <button v-if="searchBtn" type="button" :disabled="disabled" :aria-label="$t('list__search')" @contextmenu.capture.stop @click.stop="handleClick('search')">
      <svg viewBox="0 0 24 24" :class="$style.outlineIcon" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
    </button>
    <button v-if="removeBtn" type="button" :disabled="disabled" :aria-label="removeLabel || $t('list__remove')" @click.stop="handleClick('remove')">
      <svg viewBox="0 0 24 24" :class="$style.outlineIcon" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  </div>
</template>

<script>
import { appSetting } from '@renderer/store/setting'

export default {
  props: {
    index: {
      type: Number,
      required: true,
    },
    playing: {
      type: Boolean,
      default: false,
    },
    disabled: Boolean,
    removeLabel: { type: String, default: '' },
    startBtn: {
      type: Boolean,
      default: false,
    },
    pauseBtn: {
      type: Boolean,
      default: false,
    },
    removeBtn: {
      type: Boolean,
      default: false,
    },
    downloadBtn: {
      type: Boolean,
      default: true,
    },
    playBtn: {
      type: Boolean,
      default: true,
    },
    listAddBtn: {
      type: Boolean,
      default: true,
    },
    searchBtn: {
      type: Boolean,
      default: false,
    },
    fileBtn: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['btn-click'],
  setup() {
    return {
      appSetting,
    }
  },
  methods: {
    handleClick(action) {
      if (this.disabled) return
      this.$emit('btn-click', { action, index: this.index })
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btns {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  line-height: 1.2;

  button {
    background-color: transparent;
    border: none;
    border-radius: @form-radius;
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 6px;
    color: var(--color-button-font);
    outline: none;
    transition: background-color 0.2s ease;
    line-height: 0;
    &:last-child {
      margin-right: 0;
    }

    svg {
      width: 16px;
      height: 16px;
    }

    &:disabled { opacity: .4; cursor: default; }
    &:hover:not(:disabled) {
      background-color: var(--color-button-background-hover);
    }
    &:active:not(:disabled) {
      background-color: var(--color-button-background-active);
    }
    .outlineIcon { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
      background-color: var(--color-button-background-hover);
    }
  }
}

</style>
