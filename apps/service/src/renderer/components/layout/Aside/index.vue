<template>
  <div :class="$style.aside">
    <div :class="$style.logo" title="TuneFlow · 音流">
      <img :src="tuneFlowIcon" alt="TuneFlow 音流">
    </div>
    <NavBar />
  </div>
</template>

<script setup>
import tuneFlowIcon from '../../../../../TuneFlow.png'
import NavBar from './NavBar.vue'

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.aside {
  // box-shadow: 0 0 5px rgba(0, 0, 0, .3);
  transition: @transition-normal;
  transition-property: background-color;
  // background-color: @color-theme-sidebar;
  // background-color: @color-aside-background;
  // border-right: 2px solid var(--color-primary);
  -webkit-app-region: drag;
  -webkit-user-select: none;
  display: flex;
  flex-flow: column nowrap;

}

.logo {
  box-sizing: border-box;
  padding: 7px 13%;
  height: 50px;
  opacity: .8;
  flex: none;
  text-align: center;
  // -webkit-app-region: no-drag;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

</style>
