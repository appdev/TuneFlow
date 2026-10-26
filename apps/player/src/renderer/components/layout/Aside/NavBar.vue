<template>
  <div ref="dom_menu" :class="$style.menu">
    <ul ref="dom_list" :class="$style.list" role="toolbar">
      <li
        v-show="indicator.height > 0"
        :class="[$style.indicator, { [$style.indicatorReady]: indicatorReady }]"
        :style="{ transform: `translateY(${indicator.top}px)`, height: `${indicator.height}px` }"
        role="presentation"
        aria-hidden="true"
      />
      <li v-for="item in menus" :key="item.to" :class="$style.navItem" role="presentation">
        <router-link :class="[$style.link, {[$style.active]: $route.meta.name == item.name}]" role="tab" :aria-selected="$route.meta.name == item.name" :to="item.to" :aria-label="item.tips">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path :d="item.icon" />
          </svg>
          <span>{{ item.tips }}</span>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { useI18n } from '@root/lang'
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { useRoute } from '@common/utils/vueRouter'

export default {
  name: 'NavBar',
  setup() {
    const t = useI18n()
    const dom_menu = ref<HTMLElement>()
    const dom_list = ref<HTMLElement>()

    const menus = computed(() => {
      return [
        {
          to: '/search',
          tips: t('nav_home'),
          icon: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z',
          name: 'Search',
          enable: true,
        },
        {
          to: '/songList/list',
          tips: t('song_list'),
          icon: 'M9 18V5l12-2v13M9 9l12-2M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm12-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
          name: 'SongList',
          enable: true,
        },
        {
          to: '/leaderboard',
          tips: t('leaderboard'),
          icon: 'M5 20V10m7 10V4m7 16v-7',
          name: 'Leaderboard',
          enable: true,
        },
        {
          to: '/list',
          tips: t('my_list'),
          icon: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
          name: 'List',
          enable: true,
        },
        {
          to: '/download',
          tips: t('download'),
          icon: 'M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
          enable: true,
          name: 'Download',
        },
        {
          to: '/setting',
          tips: t('setting'),
          icon: 'M9.5 3h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.3-1.8 1.7v.2l1.8 1.7-2.5 4.3-2.4-.7-2.1 1.2-.6 2.4h-5l-.6-2.4-2.1-1.2-2.4.7-2.5-4.3 1.8-1.7v-.2l-1.8-1.7 2.5-4.3 2.4.7 2.1-1.2ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
          enable: true,
          name: 'Setting',
        },
      ].filter(m => m.enable)
    })
    const route = useRoute()
    const activeIndex = computed(() => menus.value.findIndex(m => m.name == route.meta.name))
    const indicator = reactive({ top: 0, height: 0 })

    // 样式会从 px 转为 rem；按实际布局定位，避免字号变化后逐项累积偏移。
    const updateIndicator = () => {
      const list = dom_list.value
      const target = list?.querySelector<HTMLElement>('a[aria-selected="true"]')
      if (!list || !target) { indicator.height = 0; return }
      const bounds = target.getBoundingClientRect()
      indicator.top = bounds.top - list.getBoundingClientRect().top
      indicator.height = bounds.height
    }
    watch([activeIndex, menus], updateIndicator, { flush: 'post' })

    // 首次定位不播放滑动动画，避免启动时选中块从顶部滑下来
    const indicatorReady = ref(false)
    let resizeObserver: ResizeObserver | undefined
    let readyFrame = 0
    onMounted(() => {
      updateIndicator()
      readyFrame = requestAnimationFrame(() => {
        indicatorReady.value = true
      })
      resizeObserver = new ResizeObserver(updateIndicator)
      if (dom_list.value) resizeObserver.observe(dom_list.value)
    })
    onBeforeUnmount(() => {
      resizeObserver?.disconnect()
      cancelAnimationFrame(readyFrame)
    })

    return {
      menus,
      dom_menu,
      dom_list,
      indicator,
      indicatorReady,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

/* Hallmark · component: navigation · theme: existing music palette
 * pre-emit critique: P4 H4 E4 S4 R5 V4 · scope: icons and navigation states
 */
.menu {
  --nav-active-ink: color-mix(in srgb, var(--color-nav-font) 45%, var(--color-font));
  --nav-active-surface: color-mix(in srgb, var(--color-nav-font) 12%, transparent);
  --nav-hover-surface: color-mix(in srgb, var(--color-nav-font) 6%, transparent);
  flex: auto;
}
.list {
  position: relative;
  -webkit-app-region: no-drag;
  display: flex;
  flex-flow: column nowrap;
  gap: 6px;
}
.navItem {
  position: relative;
}
.indicator {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  border-radius: 11px;
  pointer-events: none;
  background: var(--nav-active-surface);

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 3px;
    height: 16px;
    border-radius: 3px;
    transform: translateY(-50%);
    background: var(--nav-active-ink);
  }
}
.indicatorReady {
  transition: transform .12s ease-out;
}
.link {
  position: relative;
  width: 100%;
  height: 48px;
  box-sizing: border-box;
  padding: 0 16px;
  gap: 14px;
  border-radius: 11px;
  text-decoration: none;
  color: var(--color-font);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  transition: color .12s ease-out, background-color .12s ease-out;
  .mixin-ellipsis-1();

  svg {
    flex: none;
    width: 22px;
    height: 22px;
    overflow: visible;
  }

  span {
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    .mixin-ellipsis-1();
  }

  &.active {
    color: var(--nav-active-ink);
    span { font-weight: 600; }
    svg { stroke-width: 2; }
  }

  &:hover:not(.active) {
    color: var(--color-font);
    background: var(--nav-hover-surface);
  }

  &:active:not(.active) {
    background: var(--nav-active-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--nav-active-ink);
    outline-offset: -2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .indicatorReady, .link { transition: none; }
}
</style>
