<template>
  <div id="my-list" :class="$style.container" @click="handleContainerClick">
    <header class="tf-workspace-heading"><h1>我的音乐</h1><div class="tf-workspace-actions"><button type="button" @click="$refs.myList.handleImportList(undefined, 0)">导入列表</button><button type="button" class="tf-primary" @click="$refs.myList.isShowNewList = true">新建列表</button></div></header>
    <div :class="$style.workspace">
    <MyList ref="myList" :list-id="listId" @show-menu="$refs.musicList.handleMenuClick()" />
    <MusicList ref="musicList" :list-id="listId" @show-menu="$refs.myList.handleMenuClick()" />
    </div>
  </div>
</template>

<script>
import { getListPrevSelectId } from '@renderer/utils/data'
import { defaultList } from '@renderer/store/list/state'

import MyList from './MyList/index.vue'
import MusicList from './MusicList/index.vue'

export default {
  name: 'List',
  components: {
    MyList,
    MusicList,
  },
  async beforeRouteEnter(to, from, next) {
    let id = to.query.id
    if (!id) {
      id = await getListPrevSelectId()
      id ||= defaultList.id
      next({
        path: to.path,
        query: { ...to.query, id },
      })
    } else next()
  },
  beforeRouteUpdate(to, from) {
    // console.log(to, from)
    if (to.query.updated) return
    let id = to.query.id
    id ||= defaultList.id
    // if (!getList(id)) {
    //   id = defaultList.id
    // }
    this.listId = id
    const scrollIndex = to.query.scrollIndex
    const isAnimation = from.query.id == to.query.id
    this.$refs.musicList?.handleRestoreScroll(scrollIndex, isAnimation)

    return {
      path: '/list',
      query: { ...to.query, id, updated: true },
    }
  },
  beforeRouteLeave(to, from) {
    this.$refs.musicList?.saveListPosition()
  },
  data() {
    return {
      listId: null,
    }
  },
  created() {
    this.listId = this.$route.query.id || defaultList.id
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  overflow: hidden;
  height: 100%;
  display: flex;
  position: relative;
  gap: 16px;
  padding: 16px 18px calc(@height-player + 18px);
  box-sizing: border-box;
  background:
    linear-gradient(135deg, var(--q-surface-soft), var(--q-surface)),
    radial-gradient(circle at 16% 14%, var(--color-primary-alpha-900), transparent 34%);
}

.container { flex-direction: column; padding: 32px 0 0; gap: 32px; background: var(--tf-paper); }
.workspace { display: flex; gap: 40px; min-height: 0; flex: 1; }
@media (max-width: 900px) { .workspace { gap: 24px; } }
@media (max-width: 760px) { .container { padding-top: 24px; gap: 24px; } .workspace { gap: 16px; } }
.container { padding-top: 16px; gap: 16px; :global(.tf-workspace-heading h1) { font-size: 24px; } }
</style>
