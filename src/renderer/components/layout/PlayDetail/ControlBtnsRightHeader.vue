<template lang="pug">
div(:class="$style.header")
  button(type="button" data-testid="play-detail-hide" :class="$style.hide" :aria-label="$t('player__hide_detail_tip')" ignore-tip :title="$t('player__hide_detail_tip')" @click="hide")
    svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="35%" viewBox="0 0 30.727 30.727" space="preserve")
      use(xlink:href="#icon-window-hide")
</template>

<script setup>
import { setShowPlayerDetail } from '@renderer/store/player/action'

const hide = () => {
  setShowPlayerDetail(false)
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.header {
  flex: 0 0 @height-toolbar;
  position: relative;
  width: 100%;
}

.hide {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 30px;
  padding: 1px;
  border: 0;
  color: var(--color-font-label);
  background: none;
  cursor: pointer;
  opacity: .65;
  transition: opacity @transition-normal, background-color @transition-normal;

  &:hover {
    opacity: 1;
    background-color: var(--color-button-background-hover);
  }
}
</style>
