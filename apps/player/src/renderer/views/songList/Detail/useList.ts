import { ref } from '@common/utils/vueTools'
// import { useI18n } from '@renderer/plugins/i18n'
// import { } from '@renderer/store/search/state'
import { getAndSetListDetail } from '@renderer/store/songList/action'
import { listDetailInfo } from '@renderer/store/songList/state'
import { playFromPage } from '@renderer/core/player/selection'

export default () => {
  const listRef = ref<any>(null)
  let requestId = 0

  const getListData = async(source: LX.OnlineSource, id: string, page: number, refresh: boolean) => {
    const currentRequest = ++requestId
    await getAndSetListDetail(id, source, page, refresh).then(() => {
      setTimeout(() => {
        if (currentRequest == requestId && listRef.value) listRef.value.scrollToTop()
      })
    }).catch(() => {})
  }

  const handlePlayList = (index: number) => {
    void playFromPage(`songlist_${listDetailInfo.source}_${listDetailInfo.id}`, listDetailInfo.list, index)
  }


  return {
    listRef,
    listDetailInfo,
    getListData,
    handlePlayList,
  }
}
