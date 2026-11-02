<template>
  <div class="tf-leaderboard" :class="$style.leaderboard">
    <header class="tf-workspace-heading"><h1>{{ $t('leaderboard') }}</h1></header>
    <div :class="$style.workspace">
    <div :class="$style.lists">
      <div :class="$style.listsHeading">音乐平台</div>
      <div :class="$style.listsSelect">
        <SourcePicker :value="source" :options="sourceList.map(item => item.id)" :source-name="id => sourceNames[id]" prominent @change="handleToggleSource" />
      </div>
      <BoardList ref="boardListRef" :board-id="boardId" :source="source" @show-menu="$refs.musicListRef?.hideMenu()" />
    </div>
    <div :class="$style.list">
      <header :class="$style.boardHeader">
        <SourceIcon v-if="source" :source="source" :size="34" />
        <div :class="$style.boardTitle">
          <span>{{ sourceNames[source] }}</span>
          <h2>{{ boardName || $t('leaderboard') }}</h2>
        </div>
      </header>
      <MusicList ref="musicListRef" :source="source" :board-id="boardId" @show-menu="$refs.boardListRef?.hideMenu()" />
    </div>
    </div>
  </div>
</template>

<script>
import { computed, ref } from '@common/utils/vueTools'
import { getLeaderboardSetting, setLeaderboardSetting } from '@renderer/utils/data'
import BoardList from './BoardList/index.vue'
import MusicList from './MusicList/index.vue'
import { sources, boards } from '@renderer/store/leaderboard/state'
import { sourceNames } from '@renderer/store'
import SourceIcon from '@renderer/components/common/SourceIcon.vue'
import SourcePicker from '@renderer/components/common/SourcePicker.vue'
import { useRoute, useRouter } from '@common/utils/vueRouter'


const source = ref('')
const boardId = ref(null)

const verifyQueryParams = async function(to, from, next) {
  let _source = to.query.source
  let _boardId = to.query.boardId

  if (_source == null) {
    const setting = await getLeaderboardSetting()
    if (_source == null) {
      _source = sources.includes(setting.source) ? setting.source : sources[0]
      _boardId = setting.boardId
    }
    next({
      path: to.path,
      query: { ...to.query, source: _source, boardId: _boardId },
    })
    return
  }
  if (!sources.includes(_source)) {
    next({
      path: to.path,
      query: { ...to.query, source: sources[0], boardId: undefined },
    })
    return
  }
  next()
  source.value = _source
  boardId.value = _boardId
  void setLeaderboardSetting({ source: _source, boardId: _boardId })
}


export default {
  components: {
    BoardList,
    MusicList,
    SourceIcon,
    SourcePicker,
  },
  beforeRouteEnter: verifyQueryParams,
  beforeRouteUpdate: verifyQueryParams,
  setup() {
    const musicListRef = ref(null)
    const boardListRef = ref(null)
    const sourceList = computed(() => {
      return sources.map(s => ({ id: s, name: sourceNames.value[s] }))
    })
    const router = useRouter()
    const route = useRoute()
    const boardName = computed(() => boards[source.value]?.list.find(item => item.id == boardId.value)?.name ?? '')
    const handleToggleSource = (id) => {
      if (id == source.value) return
      void router.replace({
        path: route.path,
        query: {
          source: id,
          boardId: boards[id]?.list[0]?.id,
        },
      })
    }

    return {
      source,
      boardId,
      boardName,
      sourceNames,
      sourceList,
      handleToggleSource,
      musicListRef,
      boardListRef,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.leaderboard {
  height: 100%;
  display: flex;
  position: relative;
  gap: 16px;
  padding: 16px 18px calc(@height-player + 18px);
  box-sizing: border-box;
  min-height: 0;
}
.listsHeading { padding: 18px 16px 6px; font-size: 17px; font-weight: 650; }
.boardHeader {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--color-primary-alpha-900);
}
.boardTitle {
  min-width: 0;
  span { font-size: 11px; color: var(--color-font-label); }
  h2 { margin-top: 5px; font-size: 23px; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
}
.header {
  flex: none;
  width: 100%;
  display: flex;
  flex-flow: row nowrap;

}
.tab {
  flex: auto;
}
.select {
  flex: none;
  width: 80px;
}
.content {
  flex: auto;
  display: flex;
  overflow: hidden;
  flex-flow: column nowrap;
}

.lists {
  flex: none;
  width: clamp(160px, 22%, 220px);
  display: flex;
  flex-flow: column nowrap;
  overflow: hidden;
  border-radius: 20px;
  background: rgb(from var(--color-main-background) r g b / .52);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .66), 0 16px 38px rgba(72, 91, 112, .08);
  backdrop-filter: blur(16px) saturate(1.1);
}
.listsHeader {
  position: relative;
}

.listsSelect {
  font-size: 12px;

  &:hover {
    :global(.icon) {
      opacity: 1;
    }
  }

  >:global(.content) {
    display: block;
    width: 100%;
  }
  :global(.label-content) {
    margin: 7px;
    width: calc(100% - 14px);
    background-color: rgb(from var(--color-main-background) r g b / .54) !important;
    line-height: 38px;
    height: 38px;
    border-radius: 12px;
    &:hover {
      background: none !important;
    }
  }
  :global(.label) {
    color: var(--color-font) !important;
  }
  :global(.icon) {
    opacity: .6;
    transition: opacity .3s ease;
  }

  :global(.selection-list) {
    max-height: 500px;
    box-shadow: 0 1px 8px 0 rgba(0,0,0,.2);
    li {
      // background-color: var(--color-main-background);
      line-height: 38px;
      font-size: 13px;
      &:hover {
        background-color: var(--color-button-background-hover);
      }
      &:active {
        background-color: var(--color-button-background-active);
      }
    }
  }
  // line-height: 38px;
  // padding: 0 10px;
  border-bottom: 1px solid rgba(122, 136, 150, .1);
  flex: none;
}

.list {
  position: relative;
  overflow: hidden;
  height: 100%;
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
  border-radius: 20px;
  background: rgb(from var(--color-main-background) r g b / .54);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .68), 0 16px 38px rgba(72, 91, 112, .08);
  backdrop-filter: blur(16px) saturate(1.1);
  // .noItem {

  // }
}
@media (max-width: 900px) {
  .leaderboard { gap: 10px; padding: 10px 10px calc(@height-player + 12px); }
  .lists { width: 150px; }
  .boardHeader { padding: 14px; }
  .boardTitle h2 { font-size: 20px; }
}

.leaderboard { flex-direction: column; gap: 32px; padding: 32px 0 0; }
.workspace { flex: 1; min-height: 0; display: flex; gap: 40px; }
.lists { width: 216px; border-radius: 0; background: none; box-shadow: none; backdrop-filter: none; padding-right: 24px; border-right: 1px solid var(--tf-rule); box-sizing: border-box; }
.listsHeading { padding: 0 0 12px; color: var(--tf-muted); font-size: 14px; font-weight: 400; }
.listsSelect { padding-bottom: 24px; border-bottom: 1px solid var(--tf-rule); }
.list { height: auto; background: none; border-radius: 0; box-shadow: none; backdrop-filter: none; }
.boardHeader { padding: 0 0 24px; gap: 16px; border: 0; }
.boardTitle { span { font-size: 14px; color: var(--tf-muted); } h2 { margin-top: 8px; font-size: 32px; font-weight: 600; color: var(--tf-ink); } }
@media (max-width: 900px) { .workspace { gap: 24px; } .lists { width: 176px; padding-right: 16px; } .boardTitle h2 { font-size: 28px; } }
@media (max-width: 760px) { .leaderboard { padding-top: 24px; gap: 24px; } .workspace { gap: 16px; } .lists { width: 144px; padding-right: 12px; } .boardTitle h2 { font-size: 24px; } }
.leaderboard { padding-top: 16px; gap: 16px; :global(.tf-workspace-heading h1) { font-size: 24px; } }
.boardHeader { min-height: 72px; padding: 0 220px 16px 0; box-sizing: border-box; }
.boardTitle h2 { font-size: 24px; margin-top: 4px; }
@media (max-width: 900px) { .boardHeader { min-height: 0; padding: 0 0 12px; } .boardTitle h2 { font-size: 22px; } }
</style>
