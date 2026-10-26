import { ref } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import syncSourceList, { syncErrorKey } from '@renderer/store/list/syncSourceList'
import { useI18n } from '@renderer/plugins/i18n'


export default () => {
  const isShowListUpdateModal = ref(false)

  const t = useI18n()

  const handleUpdateSourceList = (listInfo: LX.List.UserListInfo) => {
    void dialog.confirm({
      message: t('lists__sync_confirm_tip', { name: listInfo.name }),
      confirmButtonText: t('list_update_modal__update'),
    }).then(isSync => {
      if (!isSync) return
      void syncSourceList(listInfo).catch(error => { void dialog(t(syncErrorKey(error))) })
    })
  }

  return {
    isShowListUpdateModal,
    handleUpdateSourceList,
  }
}
